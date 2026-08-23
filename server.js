require('dotenv').config();

const express = require('express');
const { google } = require('googleapis');
const cors = require('cors');
const crypto = require('crypto');
const Razorpay = require('razorpay');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

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

app.get('/api/razorpay-config', (req, res) => {
  if (!process.env.RAZORPAY_KEY_ID) {
    return res.status(500).json({ error: 'Razorpay is not configured' });
  }
  res.json({ key_id: process.env.RAZORPAY_KEY_ID });
});

app.post('/api/create-order', async (req, res) => {
  const amount = Number(req.body.amount);
  if (!Number.isInteger(amount) || amount < 100) {
    return res.status(400).json({ error: 'Amount must be at least 100 paise' });
  }

  try {
    const order = await razorpay.orders.create({
      amount,
      currency: req.body.currency || 'INR',
      receipt: `noteska_${Date.now()}`,
    });
    res.json({ order_id: order.id, amount: order.amount, currency: order.currency });
  } catch (error) {
    console.error('Error creating Razorpay order:', error);
    const status = error.statusCode === 401 || error.statusCode === 400 ? error.statusCode : 500;
    res.status(status).json({ error: 'Failed to create payment order' });
  }
});

app.post('/api/verify-payment', (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return res.status(400).json({ error: 'Missing payment verification fields' });
  }

  const expectedSignature = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
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
});