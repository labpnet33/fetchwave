/**
 * FetchWave — YT-API (RapidAPI) backend
 * 
 * FEATURES:
 * - Single video download with MP4 (multiple qualities) and MP3 (highest quality audio)
 * - YouTube playlist support with individual and bulk downloads
 * - FIX: This version prioritizes formats that have BOTH Video and Audio.
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

function isPlaylistUrl(url) {
  try {
    const u = new URL(url.trim());
    if (u.hostname.includes('youtube.com')) {
      return u.searchParams.has('list');
    }
  } catch (_) {}
  return false;
}

function extractPlaylistId(url) {
  try {
    const u = new URL(url.trim());
    if (u.hostname.includes('youtube.com')) {
      return u.searchParams.get('list');
    }
  } catch (_) {}
  return null;
}

/**
 * Extract audio-only formats (MP3 equivalent)
 * Returns the highest quality audio format available
 */
function extractBestAudioFormat(allFormats) {
  const audioFormats = allFormats.filter(f => {
    const isAudio = f.mimeType?.startsWith('audio');
    return isAudio && f.url;
  });

  if (audioFormats.length === 0) return null;

  // Sort by bitrate descending to get highest quality
  audioFormats.sort((a, b) => {
    const aBitrate = a.bitrate || 0;
    const bBitrate = b.bitrate || 0;
    return bBitrate - aBitrate;
  });

  return audioFormats[0];
}

async function info(req, res) {
  try {
    const url = req.body?.url;
    if (!url) return res.status(400).json({ error: 'No URL provided.' });

    const videoId = extractVideoId(url);
    const isPlaylist = isPlaylistUrl(url);
    const playlistId = extractPlaylistId(url);

    if (!videoId && !isPlaylist) {
      return res.status(400).json({ error: 'Invalid YouTube URL.' });
    }

    // Handle playlist
    if (isPlaylist && playlistId) {
      try {
        const playlistResponse = await axios.get('https://yt-api.p.rapidapi.com/search', {
          params: { query: `list:${playlistId}`, type: 'playlist' },
          headers: {
            'x-rapidapi-key':  RAPID_API_KEY,
            'x-rapidapi-host': RAPID_API_HOST,
          },
          timeout: 15000,
        });

        // Try to get playlist details
        const playlistDetailsResponse = await axios.get('https://yt-api.p.rapidapi.com/playlist', {
          params: { id: playlistId },
          headers: {
            'x-rapidapi-key':  RAPID_API_KEY,
            'x-rapidapi-host': RAPID_API_HOST,
          },
          timeout: 15000,
        });

        const playlistData = playlistDetailsResponse.data;
        const videos = (playlistData.contents || []).map(v => ({
          videoId: v.videoId,
          title: v.title,
          thumbnail: v.thumbnail?.[0]?.url || v.thumbnail,
          duration: v.lengthSeconds ? parseInt(v.lengthSeconds) : null,
          channel: v.channelTitle || v.uploader,
        }));

        return res.json({
          type: 'playlist',
          playlistId,
          playlistTitle: playlistData.title || 'Playlist',
          playlistChannel: playlistData.channelTitle || 'Unknown',
          videoCount: videos.length,
          videos,
        });
      } catch (playlistErr) {
        console.error('[/api/info] Playlist fetch error:', playlistErr.message);
        return res.status(400).json({ error: 'Failed to fetch playlist.' });
      }
    }

    // Handle single video
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

    // Extract MP4 video formats
    const videoFormats = allFormats
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
          type:       'video',
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

    // Extract best audio format (MP3)
    const bestAudioFormat = extractBestAudioFormat(allFormats);
    const audioFormats = [];
    if (bestAudioFormat) {
      audioFormats.push({
        formatId:   bestAudioFormat.itag?.toString() || 'audio_best',
        ext:        'mp3',
        quality:    bestAudioFormat.bitrate ? `${Math.round(bestAudioFormat.bitrate / 1000)}kbps` : 'High Quality',
        resolution: null,
        fps:        null,
        vcodec:     'none',
        acodec:     'aac',
        abr:        bestAudioFormat.bitrate ? Math.round(bestAudioFormat.bitrate / 1000) : null,
        filesize:   bestAudioFormat.contentLength ? parseInt(bestAudioFormat.contentLength) : null,
        isBest:     false,
        type:       'audio',
      });
    }

    const formats = [...videoFormats, ...audioFormats];

    /**
     * SORTING STRATEGY:
     * 1. Prioritize video formats first
     * 2. Then sort by resolution (height) descending
     * 3. Audio formats at the end
     */
    formats.sort((a, b) => {
      // Video formats come before audio
      if (a.type === 'video' && b.type === 'audio') return -1;
      if (a.type === 'audio' && b.type === 'video') return 1;
      
      // Within same type, sort by quality
      if (a.type === 'video' && b.type === 'video') {
        const aH = parseInt(a.quality) || 0;
        const bH = parseInt(b.quality) || 0;
        return bH - aH;
      }
      
      return 0;
    });

    // Mark the best combined format as "Best"
    if (formats.length > 0) {
        formats[0].isBest = true;
    }

    if (formats.length === 0) {
      return res.status(400).json({ error: 'No downloadable formats found.' });
    }

    return res.json({
      type: 'video',
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
  const format   = req.query?.format || 'mp4'; // 'mp4' or 'mp3'

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
    const filename = format === 'mp3' ? `${title}.mp3` : `${title}.mp4`;
    const contentType = format === 'mp3' ? 'audio/mpeg' : 'video/mp4';

    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', contentType);
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

/**
 * Bulk download endpoint for playlist videos
 * Returns a JSON with download URLs for all videos in the playlist
 */
async function bulkDownload(req, res) {
  const videoIds = req.body?.videoIds || [];
  const format = req.body?.format || 'mp4'; // 'mp4' or 'mp3'

  if (!Array.isArray(videoIds) || videoIds.length === 0) {
    return res.status(400).json({ error: 'videoIds array is required.' });
  }

  try {
    const downloads = [];

    for (const videoId of videoIds) {
      try {
        const response = await axios.get('https://yt-api.p.rapidapi.com/dl', {
          params: { id: videoId },
          headers: {
            'x-rapidapi-key':  RAPID_API_KEY,
            'x-rapidapi-host': RAPID_API_HOST,
          },
          timeout: 15000,
        });

        const data = response.data;
        if (data.error || data.status === 'FAILED') continue;

        const allFormats = [...(data.formats || []), ...(data.adaptiveFormats || [])];
        let selectedFormat = null;

        if (format === 'mp3') {
          selectedFormat = extractBestAudioFormat(allFormats);
        } else {
          // Get best video format
          const videoFormats = allFormats.filter(f => 
            f.mimeType?.includes('video/mp4') && f.qualityLabel === '720p'
          );
          selectedFormat = videoFormats[0] || allFormats.find(f => f.mimeType?.includes('video/mp4'));
        }

        if (selectedFormat?.url) {
          downloads.push({
            videoId,
            title: data.title,
            url: selectedFormat.url,
            format,
          });
        }
      } catch (err) {
        console.error(`[/api/bulk-download] Error for video ${videoId}:`, err.message);
        continue;
      }
    }

    return res.json({ downloads });
  } catch (err) {
    console.error('[/api/bulk-download]', err.message);
    return res.status(500).json({ error: 'Bulk download preparation failed.' });
  }
}

module.exports = { info, download, bulkDownload };
