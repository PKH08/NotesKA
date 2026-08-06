const express = require('express');
const { google } = require('googleapis');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());

// Configure Google Auth
const auth = new google.auth.GoogleAuth({
  keyFile: path.join(__dirname, 'service-account-key.json'),
  scopes: ['https://www.googleapis.com/auth/drive.readonly'],
});

const drive = google.drive({ version: 'v3', auth });
const FOLDER_ID = '1_JvyLzENHeXDc743WSt68ix5JTcoHEVo';

// 1. Serve static files (index.html) from the project folder
app.use(express.static(__dirname));

// 2. Serve index.html on root access
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// 3. API endpoint for file data
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

app.listen(3000, () => {
  console.log('Server running on http://localhost:3000');
});

// Use environment port or default to 3000
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`NotesKA server running on port ${PORT}`);
});

let auth;

if (process.env.GOOGLE_JSON_KEY) {
  try {
    // Parse JSON string safely
    const credentials = typeof process.env.GOOGLE_JSON_KEY === 'string' 
      ? JSON.parse(process.env.GOOGLE_JSON_KEY) 
      : process.env.GOOGLE_JSON_KEY;

    // Replace escaped newlines if private_key gets flattened by Render
    if (credentials.private_key) {
      credentials.private_key = credentials.private_key.replace(/\\n/g, '\n');
    }

    auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/drive.readonly'],
    });
  } catch (err) {
    console.error('Failed to parse GOOGLE_JSON_KEY environment variable:', err);
  }
} else {
  auth = new google.auth.GoogleAuth({
    keyFile: path.join(__dirname, 'service-account-key.json'),
    scopes: ['https://www.googleapis.com/auth/drive.readonly'],
  });
}