const express = require('express');
const { google } = require('googleapis');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.static(__dirname));

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

const CURRENT_UPDATE_VERSION = 'v1.1.0';
const announcements = [
  {
    id: 'v1.1.0',
    date: 'August 18, 2026',
    title: 'New Question Bank & Notes Uploaded',
    details: 'Added 2026 Model Question Papers and Unit 3 Notes to the Notes directory.'
  }
];

// Root Route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Updates Endpoint
app.get('/api/updates', (req, res) => {
  res.json({
    latestVersion: CURRENT_UPDATE_VERSION,
    announcements: announcements
  });
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

// Global Search Endpoint across Drive
app.get('/api/search', async (req, res) => {
  const term = req.query.q || '';
  if (!term.trim()) {
    return res.json([]);
  }

  try {
    // Search by file name match (case-insensitive substring)
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