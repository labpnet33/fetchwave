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
const { spawn } = require('child_process');
const { pipeline } = require('stream/promises');

const RAPID_API_KEY  = process.env.RAPID_API_KEY || 'YOUR_KEY_HERE';
const RAPID_API_HOST = 'yt-api.p.rapidapi.com';

/** Client picks this to download best separate video+audio merged (4K HDR, etc.) */
const MERGE_FORMAT_ID = '__MERGE_BEST__';

function resolveFfmpegPath() {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  try {
    return require('ffmpeg-static');
  } catch (_) {
    return null;
  }
}

/** Best adaptive video + best adaptive audio (YouTube splits 4K+ from audio). */
function pickBestVideoAndAudio(allFormats) {
  const withUrl = allFormats.filter((f) => f.url);
  const videos = withUrl.filter(
    (f) => f.mimeType?.startsWith('video/') && !f.mimeType?.startsWith('audio/'),
  );
  const audios = withUrl.filter((f) => f.mimeType?.startsWith('audio/'));
  videos.sort((a, b) => (b.height || 0) - (a.height || 0));
  audios.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
  const video =
    videos.find((v) => v.mimeType?.includes('video/mp4') && v.mimeType?.includes('avc1')) ||
    videos.find((v) => v.mimeType?.includes('video/mp4')) ||
    videos[0];
  const audio =
    audios.find((a) => a.mimeType?.includes('audio/mp4')) ||
    audios.find((a) => a.mimeType?.includes('aac')) ||
    audios[0];
  return { video, audio };
}

/** Single progressive file from `formats` (muxed), highest resolution. */
function pickBestProgressiveMuxed(data) {
  const list = (data.formats || []).filter(
    (f) => f.url && f.mimeType?.includes('video/mp4'),
  );
  list.sort((a, b) => (b.height || 0) - (a.height || 0));
  return list[0] || null;
}

/**
 * Stream from YouTube CDN through this server. Uses axios so HTTP redirects are followed
 * (raw https.get does not — that produced tiny/corrupt “downloads”).
 */
async function streamUrlToClient(req, res, sourceUrl, filename, fallbackContentType) {
  const upstreamResp = await axios({
    method: 'GET',
    url: sourceUrl,
    responseType: 'stream',
    maxRedirects: 15,
    timeout: 0,
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
    validateStatus: (s) => s >= 200 && s < 400,
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Referer: 'https://www.youtube.com/',
      Accept: '*/*',
    },
  });

  if (upstreamResp.status >= 400) {
    if (!res.headersSent) {
      res.status(upstreamResp.status).json({ error: 'Upstream returned an error.' });
    }
    upstreamResp.data.destroy();
    return;
  }

  const ct = upstreamResp.headers['content-type'];
  const cl = upstreamResp.headers['content-length'];

  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Type', ct || fallbackContentType);
  if (cl != null && /^\d+$/.test(String(cl).trim())) {
    res.setHeader('Content-Length', String(cl).trim());
  }

  const cleanup = () => {
    if (!upstreamResp.data.destroyed) upstreamResp.data.destroy();
    if (!res.writableEnded) res.destroy();
  };
  req.once('aborted', cleanup);
  req.once('close', cleanup);

  try {
    await pipeline(upstreamResp.data, res);
  } catch (err) {
    if (err && err.code !== 'ERR_STREAM_PREMATURE_CLOSE') {
      console.error('[/api/download] pipeline error:', err.message);
    }
    if (!upstreamResp.data.destroyed) upstreamResp.data.destroy();
    if (!res.writableEnded && !res.headersSent) {
      res.status(500).end();
    } else if (!res.writableEnded) {
      res.destroy();
    }
  }
}

function mergeVideoAudioToClient(req, res, video, audio, safeTitle, ffmpegPath) {
  return new Promise((resolve) => {
    res.setHeader('Content-Disposition', `attachment; filename="${safeTitle}.mp4"`);
    res.setHeader('Content-Type', 'video/mp4');

    const hdr =
      'Referer: https://www.youtube.com/\r\n' +
      'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36\r\n';

    const ff = spawn(
      ffmpegPath,
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-headers',
        hdr,
        '-i',
        video.url,
        '-headers',
        hdr,
        '-i',
        audio.url,
        '-c',
        'copy',
        '-map',
        '0:v:0',
        '-map',
        '1:a:0',
        '-movflags',
        'frag_keyframe+empty_moov+faststart',
        '-f',
        'mp4',
        'pipe:1',
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );

    ff.stderr.on('data', (d) => {
      const s = d.toString();
      if (s.trim()) console.error('[ffmpeg]', s.slice(0, 400));
    });

    const killFf = () => {
      if (ff && !ff.killed) ff.kill('SIGKILL');
    };
    req.once('aborted', killFf);
    req.once('close', killFf);

    ff.on('error', (err) => {
      console.error('[/api/download] ffmpeg spawn error:', err.message);
      killFf();
      if (!res.headersSent) res.status(500).json({ error: 'ffmpeg failed to start.' });
      resolve();
    });

    ff.on('close', (code) => {
      if (code !== 0 && code != null) {
        console.error('[/api/download] ffmpeg exit code:', code);
      }
    });

    pipeline(ff.stdout, res)
      .catch((err) => {
        if (err && err.code !== 'ERR_STREAM_PREMATURE_CLOSE') {
          console.error('[/api/download] merge pipeline:', err.message);
        }
        killFf();
      })
      .finally(() => resolve());
  });
}

function extractVideoId(url) {
  try {
    const u = new URL(url.trim());
    const host = u.hostname.replace(/^www\./, '');
    if (host === 'youtu.be') {
      const id = u.pathname.replace(/^\//, '').split('/')[0];
      return id || null;
    }
    if (host.includes('youtube.com') || host.endsWith('youtube-nocookie.com')) {
      if (u.pathname.startsWith('/shorts/')) {
        const id = u.pathname.split('/')[2];
        return id || null;
      }
      if (u.pathname.startsWith('/embed/')) {
        const id = u.pathname.split('/')[2]?.split('?')[0];
        return id || null;
      }
      if (u.pathname.startsWith('/live/')) {
        const id = u.pathname.split('/')[2]?.split('?')[0];
        return id || null;
      }
      if (u.pathname.startsWith('/v/')) {
        const id = u.pathname.split('/')[2]?.split('?')[0];
        return id || null;
      }
      return u.searchParams.get('v');
    }
  } catch (_) {}
  return null;
}

function isPlaylistUrl(url) {
  try {
    const u = new URL(url.trim());
    const host = u.hostname.replace(/^www\./, '');
    if (host.includes('youtube.com') || host.endsWith('youtube-nocookie.com')) {
      return u.searchParams.has('list');
    }
  } catch (_) {}
  return false;
}

function extractPlaylistId(url) {
  try {
    const u = new URL(url.trim());
    const host = u.hostname.replace(/^www\./, '');
    if (host.includes('youtube.com') || host.endsWith('youtube-nocookie.com')) {
      return u.searchParams.get('list');
    }
  } catch (_) {}
  return null;
}

function normalizeThumbnail(thumb) {
  if (thumb == null) return '';
  if (typeof thumb === 'string') return thumb;
  if (Array.isArray(thumb)) {
    const first = thumb[0];
    if (typeof first === 'string') return first;
    return first?.url || first?.src || '';
  }
  if (typeof thumb === 'object') return thumb.url || thumb.src || '';
  return '';
}

function looksLikeYoutubeVideoId(s) {
  return typeof s === 'string' && /^[a-zA-Z0-9_-]{11}$/.test(s);
}

/** Last resort: find an 11-char video id nested in API objects */
function deepFindVideoId(obj, depth = 0) {
  if (depth > 12 || obj == null || typeof obj !== 'object') return null;
  const v = obj.videoId;
  if (looksLikeYoutubeVideoId(v)) return v;
  for (const val of Object.values(obj)) {
    const r = deepFindVideoId(val, depth + 1);
    if (r) return r;
  }
  return null;
}

/** Resolve nested playlist item shapes from yt-api / InnerTube-style payloads */
function normalizePlaylistEntry(entry) {
  if (typeof entry === 'string' && looksLikeYoutubeVideoId(entry)) {
    return {
      videoId: entry,
      title: 'Untitled',
      thumbnail: '',
      duration: null,
      channel: '—',
    };
  }
  if (!entry || typeof entry !== 'object') return null;
  if (entry.continuationItemRenderer || entry.continuationEndpoint) return null;

  const node =
    entry.playlistItemRenderer?.playlistVideoRenderer ||
    entry.playlistItemRenderer?.videoRenderer ||
    entry.playlistItemRenderer ||
    entry.playlistVideoRenderer ||
    entry.videoRenderer ||
    entry.gridVideoRenderer ||
    entry.compactVideoRenderer ||
    entry.content?.playlistVideoRenderer ||
    entry.content?.videoRenderer ||
    entry.video ||
    entry;

  let id =
    node.videoId ||
    node.id ||
    entry.videoId ||
    entry.id ||
    entry.video_id;
  if (id != null && typeof id !== 'string') id = String(id);
  if (!looksLikeYoutubeVideoId(id)) id = deepFindVideoId(entry, 0);
  if (!looksLikeYoutubeVideoId(id)) return null;

  const title =
    (typeof node.title === 'string' ? node.title : null) ||
    node.title?.simpleText ||
    node.title?.runs?.map((r) => r.text).join('') ||
    entry.title ||
    'Untitled';
  const thumbRaw =
    node.thumbnail?.thumbnails ||
    node.thumbnail ||
    node.thumbnails ||
    entry.thumbnail;
  const duration =
    node.lengthSeconds ??
    node.lengthText?.simpleText ??
    entry.lengthSeconds ??
    entry.length;
  let durationSec = null;
  if (duration != null && typeof duration === 'number') durationSec = duration;
  else if (typeof duration === 'string' && /^\d+$/.test(duration)) {
    durationSec = parseInt(duration, 10);
  }
  const channel =
    node.shortBylineText?.runs?.[0]?.text ||
    node.ownerText?.runs?.[0]?.text ||
    node.longBylineText?.runs?.[0]?.text ||
    entry.channelTitle ||
    entry.author ||
    entry.uploader ||
    '—';
  return {
    videoId: id,
    title,
    thumbnail: normalizeThumbnail(thumbRaw),
    duration: durationSec,
    channel,
  };
}

function collectJsonArrays(obj, out, seen, depth = 0) {
  if (depth > 14 || obj == null || typeof obj !== 'object') return;
  if (seen.has(obj)) return;
  seen.add(obj);
  if (Array.isArray(obj)) {
    if (obj.length > 0) out.push(obj);
    for (const el of obj) collectJsonArrays(el, out, seen, depth + 1);
    return;
  }
  for (const v of Object.values(obj)) collectJsonArrays(v, out, seen, depth + 1);
}

function scoreVideoEntryArray(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return 0;
  return arr.reduce((n, item) => n + (normalizePlaylistEntry(item) ? 1 : 0), 0);
}

/**
 * yt-api playlist JSON shape varies; find the array that actually holds videos.
 */
function videosFromPlaylistPayload(playlistData) {
  const roots = [
    playlistData,
    playlistData?.data,
    playlistData?.body,
    playlistData?.result,
    playlistData?.playlist,
  ].filter((x) => x && typeof x === 'object');

  let bestArr = [];
  let bestScore = 0;

  function considerList(candidate) {
    if (!Array.isArray(candidate) || candidate.length === 0) return;
    const score = scoreVideoEntryArray(candidate);
    if (score > bestScore) {
      bestScore = score;
      bestArr = candidate;
    }
  }

  for (const root of roots) {
    for (const key of ['videos', 'contents', 'items', 'results', 'entries', 'list']) {
      const block = root[key];
      if (block && typeof block === 'object' && !Array.isArray(block)) {
        considerList(Object.values(block));
      }
    }
    const arrays = [];
    collectJsonArrays(root, arrays, new WeakSet(), 0);
    for (const arr of arrays) considerList(arr);
  }

  if (bestScore === 0) return [];

  const videos = [];
  const seenIds = new Set();
  for (const entry of bestArr) {
    const v = normalizePlaylistEntry(entry);
    if (!v || seenIds.has(v.videoId)) continue;
    seenIds.add(v.videoId);
    videos.push(v);
  }
  return videos;
}

function nextPlaylistContinuationToken(data) {
  if (!data || typeof data !== 'object') return null;
  const t =
    data.continuation ||
    data.token ||
    data.nextPageToken ||
    data.nextContinuationData?.continuation ||
    data.continuationEndpoint?.continuationCommand?.token ||
    data.continuationCommand?.token;
  return typeof t === 'string' && t.length > 0 ? t : null;
}

async function fetchPlaylistAllVideos(playlistId, headers, idParam = 'id') {
  let token = null;
  let prevToken = null;
  const merged = [];
  const seenIds = new Set();
  let playlistTitle = 'Playlist';
  let playlistChannel = 'Unknown';

  for (let page = 0; page < 50; page++) {
    const params = { [idParam]: playlistId };
    if (token) params.token = token;

    const { data } = await axios.get('https://yt-api.p.rapidapi.com/playlist', {
      params,
      headers,
      timeout: 20000,
    });

    if (data?.error || data?.status === 'FAILED') {
      if (page === 0) {
        const msg = data?.message || 'Playlist unavailable from API.';
        throw new Error(msg);
      }
      break;
    }

    if (page === 0) {
      const meta = data?.data && typeof data.data === 'object' ? data.data : data;
      playlistTitle =
        meta.title ||
        meta.playlistTitle ||
        meta.name ||
        data.title ||
        playlistTitle;
      playlistChannel =
        meta.channelTitle ||
        meta.author ||
        meta.owner?.title ||
        data.channelTitle ||
        playlistChannel;
    }

    const batch = videosFromPlaylistPayload(data);
    for (const v of batch) {
      if (seenIds.has(v.videoId)) continue;
      seenIds.add(v.videoId);
      merged.push(v);
    }

    const next = nextPlaylistContinuationToken(data);
    if (!next || next === prevToken) break;
    prevToken = next;
    token = next;
  }

  return { videos: merged, playlistTitle, playlistChannel };
}

async function fetchPlaylistWithFallback(playlistId, headers) {
  let out = await fetchPlaylistAllVideos(playlistId, headers, 'id');
  if (out.videos.length === 0) {
    out = await fetchPlaylistAllVideos(playlistId, headers, 'list');
  }
  return out;
}

function canonicalHeightFromRow(row) {
  if (row.height && row.height > 0) return row.height;
  const m = String(row.quality || '').match(/(\d{3,4})p\b/i);
  if (m) return parseInt(m[1], 10);
  return 0;
}

/** Prefer muxed (video+audio); then higher bitrate / size */
function muxedVideoBetter(a, b) {
  const aMux = a.acodec !== 'none';
  const bMux = b.acodec !== 'none';
  if (aMux !== bMux) return aMux;
  const abrA = a.abr || 0;
  const abrB = b.abr || 0;
  if (abrA !== abrB) return abrA > abrB;
  const szA = a.filesize || 0;
  const szB = b.filesize || 0;
  return szA >= szB;
}

function dedupeVideoFormatsByHeight(rows) {
  const byH = new Map();
  for (const row of rows) {
    const h = canonicalHeightFromRow(row);
    if (!h) continue;
    const prev = byH.get(h);
    if (!prev || muxedVideoBetter(row, prev)) byH.set(h, row);
  }
  return [...byH.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([, row]) => row);
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

    if (!videoId && !(isPlaylist && playlistId)) {
      return res.status(400).json({ error: 'Invalid YouTube URL.' });
    }

    // Any URL with ?list= returns the full playlist (including watch?v=…&list=…).
    if (isPlaylist && playlistId) {
      try {
        const headers = {
          'x-rapidapi-key': RAPID_API_KEY,
          'x-rapidapi-host': RAPID_API_HOST,
        };
        const { videos, playlistTitle, playlistChannel } = await fetchPlaylistWithFallback(
          playlistId,
          headers,
        );

        if (videos.length === 0) {
          console.error(
            '[/api/info] Playlist parsed 0 videos for id=%s (check API key & response shape)',
            playlistId,
          );
          return res.status(400).json({
            error:
              'No videos found for this playlist. The playlist may be private, the ID may be invalid, or the upstream API response format changed.',
          });
        }

        return res.json({
          type: 'playlist',
          playlistId,
          playlistTitle,
          playlistChannel,
          videoCount: videos.length,
          videos,
          contextVideoId: videoId || undefined,
        });
      } catch (playlistErr) {
        console.error('[/api/info] Playlist fetch error:', playlistErr.message);
        return res.status(400).json({
          error: playlistErr.message || 'Failed to fetch playlist.',
        });
      }
    }

    if (!videoId) {
      return res.status(400).json({ error: 'Invalid YouTube URL.' });
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

    const allowedQualities = [
      '144p', '240p', '360p', '480p', '720p', '1080p', '1440p', '2160p', '4320p',
    ];
    const allowedHeights = new Set([144, 240, 360, 480, 720, 1080, 1440, 2160, 4320]);

    function isAllowedVideoRow(row) {
      if (row.ext !== 'mp4' || row.vcodec === 'none') return false;
      const q = String(row.quality || '').toLowerCase();
      if (allowedQualities.some((lab) => q.includes(lab))) return true;
      const pm = q.match(/(\d{3,4})p\b/);
      if (pm && allowedQualities.includes(`${pm[1]}p`)) return true;
      if (row.height && allowedHeights.has(row.height)) return true;
      return false;
    }

    // MP4 rows, then one row per height: prefer muxed (video+audio), then highest bitrate/size
    const videoFormatsRaw = allFormats
      .filter((f) => f.url)
      .map((f, i) => {
        const isMp4 =
          f.mimeType?.includes('video/mp4') ||
          f.mimeType?.includes('audio/mp4');
        const ext = isMp4 ? 'mp4' : f.mimeType?.includes('webm') ? 'webm' : 'mp4';
        const quality =
          f.qualityLabel ||
          (f.height ? `${f.height}p` : null) ||
          (f.bitrate ? `${Math.round(f.bitrate / 1000)}kbps` : '');

        return {
          formatId: f.itag?.toString() || i.toString(),
          ext,
          quality,
          resolution: f.qualityLabel || null,
          height: f.height || null,
          fps: f.fps || null,
          vcodec: f._hasVideo ? 'h264' : 'none',
          acodec: f._hasAudio ? 'aac' : 'none',
          abr: f.bitrate ? Math.round(f.bitrate / 1000) : null,
          filesize: f.contentLength ? parseInt(f.contentLength, 10) : null,
          isBest: false,
          type: 'video',
        };
      })
      .filter(isAllowedVideoRow);

    const muxedRows = videoFormatsRaw.filter((r) => r.acodec !== 'none');
    const forDedupe = muxedRows.length > 0 ? muxedRows : videoFormatsRaw;

    const muxedDeduped = dedupeVideoFormatsByHeight(forDedupe).map(
      ({ height: _h, ...out }) => out,
    );

    const mergeEntry = {
      formatId: MERGE_FORMAT_ID,
      ext: 'mp4',
      quality: 'Best merged (max quality + audio)',
      resolution: null,
      fps: null,
      vcodec: 'h264',
      acodec: 'aac',
      filesize: null,
      isBest: true,
      type: 'merged',
    };

    const videoFormats = muxedDeduped.map((row) => ({ ...row, isBest: false }));

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

    const formats = [mergeEntry, ...videoFormats, ...audioFormats];

    /**
     * SORTING: merged first, then muxed by height desc, then audio.
     */
    formats.sort((a, b) => {
      if (a.type === 'merged' && b.type !== 'merged') return -1;
      if (a.type !== 'merged' && b.type === 'merged') return 1;
      if (a.type === 'video' && b.type === 'audio') return -1;
      if (a.type === 'audio' && b.type === 'video') return 1;
      if (a.type === 'video' && b.type === 'video') {
        const aH = parseInt(a.quality) || 0;
        const bH = parseInt(b.quality) || 0;
        return bH - aH;
      }
      return 0;
    });

    if (formats.length === 0) {
      return res.status(400).json({ error: 'No downloadable formats found.' });
    }

    return res.json({
      type: 'video',
      title:     data.title,
      channel:   data.channelTitle || data.uploader,
      duration:  data.lengthSeconds ? parseInt(data.lengthSeconds, 10) : null,
      thumbnail: normalizeThumbnail(data.thumbnail),
      videoId,
      formats,
    });

  } catch (err) {
    console.error('[/api/info]', err.response?.data || err.message);
    return res.status(500).json({ error: err.response?.data?.message || err.message });
  }
}

async function download(req, res) {
  const url = req.query?.url;
  const formatId = req.query?.format_id;
  const format = req.query?.format || 'mp4';
  const direct = req.query?.direct === '1' || req.query?.direct === 'true';

  if (!url || !formatId) {
    return res.status(400).json({ error: 'url and format_id are required.' });
  }

  try {
    const videoId = extractVideoId(url);
    if (!videoId) return res.status(400).json({ error: 'Invalid YouTube URL.' });

    const response = await axios.get('https://yt-api.p.rapidapi.com/dl', {
      params: { id: videoId },
      headers: {
        'x-rapidapi-key': RAPID_API_KEY,
        'x-rapidapi-host': RAPID_API_HOST,
      },
      timeout: 15000,
    });

    const data = response.data;
    if (data.status === 'FAILED' || data.error) {
      return res.status(400).json({ error: data.message || 'Failed to fetch video.' });
    }

    const allFormats = [...(data.formats || []), ...(data.adaptiveFormats || [])];
    const title = (data.title || 'video').replace(/[^a-z0-9]/gi, '_').slice(0, 60);

    if (direct) {
      const fmt = allFormats.find((f) => f.itag?.toString() === formatId);
      if (!fmt?.url) return res.status(404).json({ error: 'Format not found.' });
      return res.redirect(302, fmt.url);
    }

    if (formatId === MERGE_FORMAT_ID) {
      const { video, audio } = pickBestVideoAndAudio(allFormats);

      if (video?.url && audio?.url && video.url === audio.url) {
        await streamUrlToClient(req, res, video.url, `${title}.mp4`, 'video/mp4');
        return;
      }

      const ffmpegPath = resolveFfmpegPath();
      if (ffmpegPath && video?.url && audio?.url) {
        await mergeVideoAudioToClient(req, res, video, audio, title, ffmpegPath);
        return;
      }

      const muxed = pickBestProgressiveMuxed(data);
      if (muxed?.url) {
        await streamUrlToClient(req, res, muxed.url, `${title}.mp4`, 'video/mp4');
        return;
      }

      if (video?.url) {
        await streamUrlToClient(req, res, video.url, `${title}.mp4`, 'video/mp4');
        return;
      }

      return res.status(400).json({
        error:
          'Could not build a merged download. Install ffmpeg, set FFMPEG_PATH, or pick a specific quality below.',
      });
    }

    const fmt = allFormats.find((f) => f.itag?.toString() === formatId);
    if (!fmt?.url) return res.status(404).json({ error: 'Format not found.' });

    const filename = format === 'mp3' ? `${title}.mp3` : `${title}.mp4`;
    const fallbackType = format === 'mp3' ? 'audio/mpeg' : 'video/mp4';

    await streamUrlToClient(req, res, fmt.url, filename, fallbackType);
  } catch (err) {
    console.error('[/api/download] Catch error:', err.message);
    if (!res.headersSent) res.status(500).json({ error: err.message || 'Download failed.' });
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
        const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;

        if (format === 'mp3') {
          const selectedFormat = extractBestAudioFormat(allFormats);
          if (selectedFormat?.itag != null) {
            downloads.push({
              videoId,
              title: data.title,
              url: `/api/download?url=${encodeURIComponent(watchUrl)}&format_id=${encodeURIComponent(String(selectedFormat.itag))}&format=mp3`,
              format,
            });
          }
        } else {
          downloads.push({
            videoId,
            title: data.title,
            url: `/api/download?url=${encodeURIComponent(watchUrl)}&format_id=${encodeURIComponent(MERGE_FORMAT_ID)}&format=mp4`,
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
