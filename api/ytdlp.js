/**
 * FetchWave — YT-API (RapidAPI) backend
 */
const axios = require('axios');

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

    // Combined streams (video + audio) e.g. 360p
    const combined = (data.formats || []).map(f => ({
      ...f,
      _hasVideo: true,
      _hasAudio: true,
    }));

    // Adaptive streams — video only or audio only (720p, 1080p, 4K etc.)
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

        const quality = f.qualityLabel
          || (f.bitrate ? `${Math.round(f.bitrate / 1000)}kbps` : 'audio');

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
        return allowedQualities.some(q => f.quality.includes(q));
      });

    // Sort: combined first, then by height descending
    formats.sort((a, b) => {
      const aIsCombined = a.vcodec !== 'none' && a.acodec !== 'none';
      const bIsCombined = b.vcodec !== 'none' && b.acodec !== 'none';
      if (aIsCombined && !bIsCombined) return -1;
      if (!aIsCombined && bIsCombined) return 1;
      const aH = parseInt(a.quality) || 0;
      const bH = parseInt(b.quality) || 0;
      return bH - aH;
    });

    // Mark best as highest resolution combined, or highest overall
    if (formats.length > 0) formats[0].isBest = true;

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
    const isMp4    = fmt.mimeType?.includes('video/mp4') || fmt.mimeType?.includes('audio/mp4');
    const ext      = isMp4 ? 'mp4' : (fmt.mimeType?.includes('webm') ? 'webm' : 'mp4');
    const filename = `${title}.${ext}`;

    // Use axios to get the stream from the direct URL
    const videoStream = await axios.get(fmt.url, {
      responseType: 'stream',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://www.youtube.com/',
      },
    });

    // Explicitly set headers to force download as video/mp4
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', isMp4 ? 'video/mp4' : (fmt.mimeType || 'video/mp4'));
    
    if (fmt.contentLength) {
      res.setHeader('Content-Length', fmt.contentLength);
    }

    // Pipe the stream directly to the response
    videoStream.data.pipe(res);

    videoStream.data.on('error', (err) => {
      console.error('[/api/download] Stream error:', err.message);
      if (!res.headersSent) {
        res.status(500).send('Download failed during streaming.');
      }
    });

  } catch (err) {
    console.error('[/api/download]', err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Download failed: ' + err.message });
    }
  }
}
module.exports = { info, download };
