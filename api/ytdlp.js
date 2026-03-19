/**
 * FetchWave — YT-API (RapidAPI) backend
 * 
 * FIX: This version prioritizes formats that have BOTH Video and Audio.
 * High quality (720p, 1080p) is often stored separately on YouTube.
 * We'll filter to show the best available combined formats first.
 */
const axios = require('axios');
const https = require('https');

const RAPID_API_KEY  = process.env.RAPID_API_KEY || 'YOUR_KEY_HERE';
const RAPID_API_HOST = 'yt-api.p.rapidapi.com';

function extractVideoId(url) {
  try {
    const u = new URL(url.trim());
    if (u.hostname.includes('youtube.com')) {
      if (u.pathname.startsWith('/shorts/')) return u.pathname.split('/')[2];
      return u.searchParams.get('v');
    }
    if (u.hostname === 'youtu.be') return u.pathname.slice(1).split('?')[0];
  } catch (_) {}
  return null;
}

async function info(req, res) {
  try {
    const url = req.body?.url;
    if (!url) return res.status(400).json({ error: 'No URL provided.' });

    const videoId = extractVideoId(url);
    if (!videoId) return res.status(400).json({ error: 'Invalid YouTube URL.' });

    const response = await axios.get('https://yt-api.p.rapidapi.com/dl', {
      params: { id: videoId },
      headers: {
        'x-rapidapi-key':  RAPID_API_KEY,
        'x-rapidapi-host': RAPID_API_HOST,
      },
      timeout: 15000,
    });

    const data = response.data;

    if (data.status === 'FAILED' || data.error) {
      return res.status(400).json({ error: data.message || 'Failed to fetch video.' });
    }

    // Process formats to identify video/audio content
    const combined = (data.formats || []).map(f => ({
      ...f,
      _hasVideo: true,
      _hasAudio: true,
    }));

    const adaptive = (data.adaptiveFormats || []).map(f => ({
      ...f,
      _hasVideo: f.mimeType?.startsWith('video'),
      _hasAudio: f.mimeType?.startsWith('audio'),
    }));

    const allFormats = [...combined, ...adaptive];
    
    // Define allowed quality options (MP4 only)
    const allowedQualities = ['144p', '360p', '720p', '1080p', '1440p'];

    const formats = allFormats
      .filter(f => f.url)
      .map((f, i) => {
        const isMp4 = f.mimeType?.includes('video/mp4') || f.mimeType?.includes('audio/mp4');
        const ext = isMp4 ? 'mp4' : (f.mimeType?.includes('webm') ? 'webm' : 'mp4');
        const quality = f.qualityLabel || (f.bitrate ? `${Math.round(f.bitrate / 1000)}kbps` : 'audio');

        return {
          formatId:   f.itag?.toString() || i.toString(),
          ext,
          quality,
          resolution: f.qualityLabel || null,
          fps:        f.fps || null,
          vcodec:     f._hasVideo ? 'h264' : 'none',
          acodec:     f._hasAudio ? 'aac' : 'none',
          abr:        f.bitrate ? Math.round(f.bitrate / 1000) : null,
          filesize:   f.contentLength ? parseInt(f.contentLength) : null,
          isBest:     false,
        };
      })
      .filter(f => {
        // Only include MP4 formats with allowed quality labels
        if (f.ext !== 'mp4') return false;
        if (!f.quality) return false;
        
        // Check if quality matches one of the allowed options
        const matchesQuality = allowedQualities.some(q => f.quality.includes(q));
        if (!matchesQuality) return false;

        return true;
      });

    /**
     * SORTING STRATEGY:
     * 1. Prioritize formats that have BOTH video and audio (combined)
     * 2. Then sort by resolution (height) descending
     */
    formats.sort((a, b) => {
      const aIsCombined = a.vcodec !== 'none' && a.acodec !== 'none';
      const bIsCombined = b.vcodec !== 'none' && b.acodec !== 'none';
      
      // Combined formats always come before video-only formats
      if (aIsCombined && !bIsCombined) return -1;
      if (!aIsCombined && bIsCombined) return 1;
      
      // If both are the same type, sort by quality (resolution)
      const aH = parseInt(a.quality) || 0;
      const bH = parseInt(b.quality) || 0;
      return bH - aH;
    });

    // Mark the best combined format as "Best"
    if (formats.length > 0) {
        formats[0].isBest = true;
    }

    if (formats.length === 0) {
      return res.status(400).json({ error: 'No downloadable formats found.' });
    }

    return res.json({
      title:     data.title,
      channel:   data.channelTitle || data.uploader,
      duration:  data.lengthSeconds ? parseInt(data.lengthSeconds) : null,
      thumbnail: data.thumbnail?.[0]?.url || data.thumbnail,
      videoId,
      formats,
    });

  } catch (err) {
    console.error('[/api/info]', err.response?.data || err.message);
    return res.status(500).json({ error: err.response?.data?.message || err.message });
  }
}

async function download(req, res) {
  const url      = req.query?.url;
  const formatId = req.query?.format_id;

  if (!url || !formatId) {
    return res.status(400).json({ error: 'url and format_id are required.' });
  }

  try {
    const videoId = extractVideoId(url);
    if (!videoId) return res.status(400).json({ error: 'Invalid YouTube URL.' });

    const response = await axios.get('https://yt-api.p.rapidapi.com/dl', {
      params: { id: videoId },
      headers: {
        'x-rapidapi-key':  RAPID_API_KEY,
        'x-rapidapi-host': RAPID_API_HOST,
      },
      timeout: 15000,
    });

    const data       = response.data;
    const allFormats = [...(data.formats || []), ...(data.adaptiveFormats || [])];
    const fmt        = allFormats.find(f => f.itag?.toString() === formatId);

    if (!fmt?.url) return res.status(404).json({ error: 'Format not found.' });

    const title    = (data.title || 'video').replace(/[^a-z0-9]/gi, '_').slice(0, 60);
    const filename = `${title}.mp4`;

    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'video/mp4');
    if (fmt.contentLength) res.setHeader('Content-Length', fmt.contentLength);

    const options = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://www.youtube.com/'
      }
    };

    https.get(fmt.url, options, (stream) => {
      if (stream.statusCode >= 400) {
        if (!res.headersSent) res.status(stream.statusCode).end();
        return;
      }
      stream.pipe(res);
      stream.on('error', (err) => {
        console.error('[/api/download] Stream error:', err.message);
        res.end();
      });
    }).on('error', (err) => {
      console.error('[/api/download] Request error:', err.message);
      if (!res.headersSent) res.status(500).end();
    });

    req.on('close', () => {
      res.end();
    });

  } catch (err) {
    console.error('[/api/download] Catch error:', err.message);
    if (!res.headersSent) res.status(500).json({ error: 'Download failed.' });
  }
}

module.exports = { info, download };
