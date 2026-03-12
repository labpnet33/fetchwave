require('dotenv').config();
/**
 * FetchWave — Express Server
 *
 * Routes:
 *   POST /api/info      → fetch video metadata + available formats
 *   GET  /api/download  → stream video file to client
 *
 * Requires: yt-dlp installed on server (PATH) or via bundled binary.
 * Deploy: Vercel (serverless) or any Node.js host.
 */

const express  = require('express');
const path     = require('path');
const ytdlp    = require('./api/ytdlp');   // helper wrapper

const app = express();
const PORT = process.env.PORT || 3000;

/* ── MIDDLEWARE ── */
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

/* ── API ROUTES ── */
app.post('/api/info',     ytdlp.info);
app.get('/api/download',  ytdlp.download);

/* ── CATCH-ALL: serve index.html for any non-API route ── */
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

/* ── START ── */
app.listen(PORT, () => {
  console.log(`✅  FetchWave running at http://localhost:${PORT}`);
});

module.exports = app;
