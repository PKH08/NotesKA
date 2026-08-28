const path = require('path');

// FIXED: Standardized dotenv config. It will now automatically find the .env file in the root directory.
const dotenvResult = require('dotenv').config();

if (dotenvResult.error) {
  console.warn('⚠️ Note: No .env file found locally. The server will rely on system environment variables (this is expected behavior for live hosting).');
}

const express = require('express');
const { google } = require('googleapis');
const cors = require('cors');
const crypto = require('crypto');
const Razorpay = require('razorpay');
const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

function getRazorpayCredentials() {
  return {
    keyId: process.env.RAZORPAY_KEY_ID?.trim(),
    keySecret: process.env.RAZORPAY_KEY_SECRET?.trim(),
  };
}

function createRazorpayClient() {
  const { keyId, keySecret } = getRazorpayCredentials();
  if (!keyId || !keySecret) return null;
  return new Razorpay({ key_id: keyId, key_secret: keySecret });
}

// Google Drive Auth Setup
let auth;
if (process.env.GOOGLE_JSON_KEY) {
  try {
    const credentials = typeof process.env.GOOGLE_JSON_KEY === 'string' 
      ? JSON.parse(process.env.GOOGLE_JSON_KEY) 
      : process.env.GOOGLE_JSON_KEY;

    if (credentials.private_key) {
      credentials.private_key = credentials.private_key.replace(/\\n/g, '\n');
    }

    auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/drive.readonly'],
    });
  } catch (err) {
    console.error('Failed to parse GOOGLE_JSON_KEY:', err);
  }
} else {
  auth = new google.auth.GoogleAuth({
    keyFile: path.join(__dirname, 'service-account-key.json'),
    scopes: ['https://www.googleapis.com/auth/drive.readonly'],
  });
}

const drive = google.drive({ version: 'v3', auth });
const FOLDER_ID = '1_JvyLzENHeXDc743WSt68ix5JTcoHEVo';

// Root Route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/api/health', (req, res) => {
  const { keyId, keySecret } = getRazorpayCredentials();
  const razorpayConfigured = Boolean(keyId && keySecret);
  res.status(razorpayConfigured ? 200 : 503).json({
    status: razorpayConfigured ? 'ok' : 'degraded',
    razorpayConfigured,
  });
});

app.get('/api/razorpay-config', (req, res) => {
  const { keyId, keySecret } = getRazorpayCredentials();
  if (!keyId || !keySecret) {
    return res.status(500).json({ error: 'Razorpay is not configured' });
  }
  res.json({ key_id: keyId });
});

app.post('/api/create-order', async (req, res) => {
  const amount = Number(req.body.amount);
  if (!Number.isInteger(amount) || amount < 100) {
    return res.status(400).json({ error: 'Amount must be at least 100 paise' });
  }

  const razorpay = createRazorpayClient();
  if (!razorpay) {
    return res.status(500).json({ error: 'Razorpay not configured on server' });
  }

  try {
    const order = await razorpay.orders.create({
      amount,
      currency: req.body.currency || 'INR',
      receipt: `noteska_${Date.now()}`,
    });
    res.json({ order_id: order.id, amount: order.amount, currency: order.currency });
  } catch (error) {
    console.error('Error creating Razorpay order:', error.message || error);
    let status = 500;
    let message = 'Failed to create payment order';
    
    if (error.statusCode === 401 || error.statusCode === 403) {
      status = 401;
      message = 'Razorpay credentials are invalid or expired. Please configure valid API keys.';
    } else if (error.statusCode === 400) {
      status = 400;
      message = error.message || 'Invalid payment parameters';
    }
    res.status(status).json({ error: message });
  }
});

app.post('/api/verify-payment', (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return res.status(400).json({ error: 'Missing payment verification fields' });
  }
  const { keySecret } = getRazorpayCredentials();
  if (!keySecret) {
    return res.status(500).json({ error: 'Razorpay secret is not configured on server' });
  }

  const expectedSignature = crypto
    .createHmac('sha256', keySecret)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest('hex');
  const signaturesMatch = expectedSignature.length === razorpay_signature.length &&
    crypto.timingSafeEqual(Buffer.from(expectedSignature), Buffer.from(razorpay_signature));

  if (!signaturesMatch) {
    return res.status(400).json({ error: 'Payment signature verification failed' });
  }
  res.json({ success: true, message: 'Payment verified successfully' });
});

// Drive Files by Folder ID
app.get('/api/files', async (req, res) => {
  const folderId = req.query.folderId || FOLDER_ID;

  try {
    const response = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false`,
      fields: 'files(id, name, mimeType, webViewLink, webContentLink)',
    });
    res.json(response.data.files);
  } catch (error) {
    console.error('Error fetching files:', error);
    res.status(500).json({ error: 'Failed to retrieve files from Google Drive' });
  }
});

// Global Search Endpoint
app.get('/api/search', async (req, res) => {
  const term = req.query.q || '';
  if (!term.trim()) {
    return res.json([]);
  }

  try {
    const response = await drive.files.list({
      q: `name contains '${term.replace(/'/g, "\\'")}' and trashed = false`,
      fields: 'files(id, name, mimeType, webViewLink, webContentLink)',
      pageSize: 30
    });
    res.json(response.data.files);
  } catch (error) {
    console.error('Error searching files:', error);
    res.status(500).json({ error: 'Search failed' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`NotesKA running on port ${PORT}`);
  
  // Diagnostic logs to verify environment variables loaded properly
  const { keyId, keySecret } = getRazorpayCredentials();
  console.log(`Razorpay Key ID Status: ${keyId ? '✅ Loaded' : '❌ Missing'}`);
  console.log(`Razorpay Key Secret Status: ${keySecret ? '✅ Loaded' : '❌ Missing'}`);
});