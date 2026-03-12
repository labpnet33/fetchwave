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

/* ── INFO ── */
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
    console.log('[/api/info] raw response:', JSON.stringify(data).slice(0, 300));

    if (data.status === 'FAILED' || data.error) {
      return res.status(400).json({ error: data.message || 'Failed to fetch video.' });
    }

    // Build formats from formats array
    const rawFormats = data.formats || data.adaptiveFormats || [];

    const formats = rawFormats
      .filter(f => f.url)
      .map((f, i) => ({
        formatId:   f.itag?.toString() || i.toString(),
        ext:        f.mimeType?.includes('mp4') ? 'mp4' : (f.mimeType?.includes('webm') ? 'webm' : 'mp4'),
        quality:    f.qualityLabel || f.quality || (f.bitrate ? `${Math.round(f.bitrate/1000)}kbps` : 'audio'),
        resolution: f.qualityLabel || null,
        fps:        f.fps || null,
        vcodec:     f.mimeType?.startsWith('video') ? 'h264' : 'none',
        acodec:     f.mimeType?.startsWith('audio') ? 'aac' : (f.mimeType?.startsWith('video') ? 'aac' : 'none'),
        abr:        f.bitrate ? Math.round(f.bitrate / 1000) : null,
        filesize:   f.contentLength ? parseInt(f.contentLength) : null,
        isBest:     i === 0,
        _url:       f.url,
      }));

    if (formats.length === 0) {
      return res.status(400).json({ error: 'No downloadable formats found for this video.' });
    }

    formats[0].isBest = true;

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

/* ── DOWNLOAD ── */
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

    const ext      = fmt.mimeType?.includes('mp4') ? 'mp4' : 'webm';
    const filename = `fetchwave-${videoId}.${ext}`;

    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.redirect(fmt.url);

  } catch (err) {
    console.error('[/api/download]', err.message);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
}

module.exports = { info, download };
