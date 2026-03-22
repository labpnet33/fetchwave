/**
 * FetchWave — Frontend App
 * Features:
 * - Single video download with MP4 (multiple qualities) and MP3 (high-quality audio)
 * - YouTube playlist support with individual and bulk downloads
 */

const urlInput       = document.getElementById('urlInput');
const clearBtn       = document.getElementById('clearBtn');
const fetchBtn       = document.getElementById('fetchBtn');
const errorBanner    = document.getElementById('errorBanner');
const errorMsg       = document.getElementById('errorMsg');
const loaderSection  = document.getElementById('loaderSection');
const resultsSection = document.getElementById('resultsSection');
const playlistSection = document.getElementById('playlistSection');
const heroSection    = document.querySelector('.hero');
const qualityGrid    = document.getElementById('qualityGrid');
const qualityCount   = document.getElementById('qualityCount');
const metaTitle      = document.getElementById('metaTitle');
const metaThumb      = document.getElementById('metaThumb');
const metaDuration   = document.getElementById('metaDuration');
const metaChannel    = document.getElementById('metaChannel');
const resetBtn       = document.getElementById('resetBtn');
const playlistTitle  = document.getElementById('playlistTitle');
const playlistCount  = document.getElementById('playlistCount');
const playlistVideos = document.getElementById('playlistVideos');
const playlistResetBtn = document.getElementById('playlistResetBtn');

let currentPlaylistData = null;
let selectedPlaylistVideos = new Set();

/* ── INIT: ensure clean state on load ── */
loaderSection.style.display  = 'none';
resultsSection.style.display = 'none';
playlistSection.style.display = 'none';
errorBanner.style.display    = 'none';

/* ── HELPERS ── */
function extractVideoId(url) {
  try {
    const u = new URL(url.trim());
    const host = u.hostname.replace(/^www\./, '');
    if (host === 'youtu.be') {
      const id = u.pathname.replace(/^\//, '').split('/')[0];
      return id || null;
    }
    if (host.includes('youtube.com') || host.endsWith('youtube-nocookie.com')) {
      if (u.pathname.startsWith('/shorts/')) return u.pathname.split('/')[2] || null;
      if (u.pathname.startsWith('/embed/')) return u.pathname.split('/')[2]?.split('?')[0] || null;
      if (u.pathname.startsWith('/live/')) return u.pathname.split('/')[2]?.split('?')[0] || null;
      if (u.pathname.startsWith('/v/')) return u.pathname.split('/')[2]?.split('?')[0] || null;
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

function resolveThumbnailUrl(thumb) {
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

function validateInput(url) {
  if (!url.trim()) return 'Please enter a YouTube URL.';
  if (!extractVideoId(url) && !isPlaylistUrl(url)) return 'Could not parse a video or playlist ID. Please use a standard YouTube link.';
  return null;
}

function showError(msg) {
  errorMsg.textContent = msg;
  errorBanner.style.display = 'flex';
}

function hideError() {
  errorBanner.style.display = 'none';
}

function setView(view) {
  loaderSection.style.display  = view === 'loading' ? 'flex'  : 'none';
  resultsSection.style.display = view === 'results' ? 'block' : 'none';
  playlistSection.style.display = view === 'playlist' ? 'block' : 'none';
  heroSection.style.display    = (view === 'results' || view === 'playlist') ? 'none'  : '';
  if (view === 'loading' || view === 'results' || view === 'playlist') hideError();
}

function formatBytes(bytes) {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDuration(seconds) {
  if (!seconds) return '';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  return `${m}:${String(s).padStart(2,'0')}`;
}

/* ── CLEAR BUTTON ── */
urlInput.addEventListener('input', () => {
  clearBtn.classList.toggle('visible', urlInput.value.length > 0);
  if (errorBanner.style.display !== 'none') hideError();
});

clearBtn.addEventListener('click', () => {
  urlInput.value = '';
  clearBtn.classList.remove('visible');
  urlInput.focus();
  hideError();
});

urlInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') fetchBtn.click();
});

/* ── RESET ── */
resetBtn.addEventListener('click', () => {
  urlInput.value = '';
  clearBtn.classList.remove('visible');
  hideError();
  setView('input');
  qualityGrid.innerHTML = '';
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

playlistResetBtn.addEventListener('click', () => {
  urlInput.value = '';
  clearBtn.classList.remove('visible');
  hideError();
  setView('input');
  playlistVideos.innerHTML = '';
  selectedPlaylistVideos.clear();
  currentPlaylistData = null;
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

/* ── FETCH ── */
fetchBtn.addEventListener('click', async () => {
  const url = urlInput.value.trim();
  const err = validateInput(url);
  if (err) { showError(err); return; }

  hideError();
  fetchBtn.disabled = true;
  fetchBtn.querySelector('.fetch-btn-text').textContent = 'Fetching…';
  setView('loading');

  try {
    const res  = await fetch('/api/info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || 'Failed to fetch video.');

    if (data.type === 'playlist') {
      renderPlaylist(data, url);
      setView('playlist');
    } else {
      renderResults(data);
      setView('results');
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });

  } catch (err) {
    setView('input');
    showError(err.message || 'An unexpected error occurred.');
  } finally {
    fetchBtn.disabled = false;
    fetchBtn.querySelector('.fetch-btn-text').textContent = 'Fetch Video';
  }
});

/* ── RENDER RESULTS (Single Video) ── */
function renderResults(data) {
  metaTitle.textContent    = data.title     || 'Unknown Title';
  metaThumb.src            = resolveThumbnailUrl(data.thumbnail);
  metaThumb.alt            = data.title     || '';
  metaDuration.textContent = formatDuration(data.duration) || '—';
  metaChannel.textContent  = data.channel   || '—';

  const formats = data.formats || [];
  qualityCount.textContent = `${formats.length} format${formats.length !== 1 ? 's' : ''}`;
  qualityGrid.innerHTML = '';
  formats.forEach((fmt, i) => qualityGrid.appendChild(buildQualityCard(fmt, i, data)));
}

/* ── RENDER PLAYLIST ── */
function renderPlaylist(data, url) {
  currentPlaylistData = { ...data, url };
  selectedPlaylistVideos.clear();

  playlistTitle.textContent = data.playlistTitle || 'Playlist';
  playlistCount.textContent = `${data.videoCount} video${data.videoCount !== 1 ? 's' : ''}`;
  playlistVideos.innerHTML = '';

  data.videos.forEach((video, i) => {
    playlistVideos.appendChild(buildPlaylistVideoCard(video, i));
  });

  if (data.contextVideoId) {
    requestAnimationFrame(() => {
      playlistVideos.querySelector('.playlist-video-context')?.scrollIntoView({
        block: 'nearest',
        behavior: 'smooth',
      });
    });
  }
}

/* ── BUILD QUALITY CARD (Single Video) ── */
function buildQualityCard(fmt, index, videoData) {
  const card = document.createElement('div');
  card.className = 'quality-card' + (fmt.isBest ? ' best' : '');
  card.style.animationDelay = `${index * 0.05}s`;

  const ext        = (fmt.ext || 'mp4').toLowerCase();
  const badgeClass = ['mp4','webm','m4a','mp3'].includes(ext) ? ext : 'other';
  const qualLabel  = fmt.quality || fmt.resolution || (fmt.abr ? `${fmt.abr}kbps` : 'Unknown');
  const typeLabel  = fmt.vcodec === 'none' ? 'Audio only'
                   : fmt.acodec === 'none' ? 'Video only'
                   : 'Video + Audio';
  const sizeStr    = formatBytes(fmt.filesize);
  const fpsStr     = fmt.fps ? `${fmt.fps}fps` : '';

  card.innerHTML = `
    <div class="card-top">
      <span class="format-badge ${badgeClass}">${ext}</span>
      ${fmt.isBest ? '<span class="best-tag">⭐ Best</span>' : ''}
    </div>
    <div class="quality-label">
      ${qualLabel}
      <span class="quality-sub">${typeLabel}</span>
    </div>
    <div class="card-meta">
      ${sizeStr ? `<span class="meta-tag">${sizeStr}</span>` : ''}
      ${fpsStr  ? `<span class="meta-tag">${fpsStr}</span>`  : ''}
    </div>
    <button class="dl-btn"
      data-format-id="${fmt.formatId}"
      data-format="${fmt.ext}"
      data-url="${encodeURIComponent(urlInput.value.trim())}">
      <span class="dl-btn-icon">↓</span>
      Download
    </button>
  `;

  card.querySelector('.dl-btn').addEventListener('click', handleDownload);
  return card;
}

/* ── BUILD PLAYLIST VIDEO CARD ── */
function buildPlaylistVideoCard(video, index) {
  const card = document.createElement('div');
  const ctxId = currentPlaylistData?.contextVideoId;
  card.className =
    'playlist-video-card' +
    (ctxId && ctxId === video.videoId ? ' playlist-video-context' : '');
  card.style.animationDelay = `${index * 0.05}s`;

  const durationStr = formatDuration(video.duration) || '—';

  card.innerHTML = `
    <div class="playlist-video-checkbox">
      <input type="checkbox" class="video-checkbox" data-video-id="${video.videoId}" />
    </div>
    <img src="${resolveThumbnailUrl(video.thumbnail)}" alt="${video.title}" class="playlist-video-thumb"/>
    <div class="playlist-video-info">
      <h4 class="playlist-video-title">${video.title}</h4>
      <p class="playlist-video-meta">${video.channel || 'Unknown'} • ${durationStr}</p>
    </div>
    <div class="playlist-video-actions">
      <button class="dl-btn-small" data-action="mp4" data-video-id="${video.videoId}">
        <span class="dl-btn-icon">↓</span> MP4
      </button>
      <button class="dl-btn-small" data-action="mp3" data-video-id="${video.videoId}">
        <span class="dl-btn-icon">↓</span> MP3
      </button>
    </div>
  `;

  // Checkbox toggle
  const checkbox = card.querySelector('.video-checkbox');
  checkbox.addEventListener('change', (e) => {
    if (e.target.checked) {
      selectedPlaylistVideos.add(video.videoId);
    } else {
      selectedPlaylistVideos.delete(video.videoId);
    }
  });

  // Individual download buttons
  card.querySelectorAll('.dl-btn-small').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const action = e.currentTarget.dataset.action;
      handlePlaylistVideoDownload(video.videoId, action);
    });
  });

  return card;
}

/* ── DOWNLOAD (Single Video) ── */
async function handleDownload(e) {
  const btn      = e.currentTarget;
  const formatId = btn.dataset.formatId;
  const format   = btn.dataset.format;
  const videoUrl = decodeURIComponent(btn.dataset.url);
  const origHTML = btn.innerHTML;

  btn.disabled  = true;
  btn.innerHTML = `<span class="dl-btn-icon">⏳</span> Preparing…`;

  try {
    const dlUrl = `/api/download?url=${encodeURIComponent(videoUrl)}&format_id=${encodeURIComponent(formatId)}&format=${format}`;
    
    const a = document.createElement('a');
    a.href = dlUrl;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    
    setTimeout(() => {
      document.body.removeChild(a);
      btn.innerHTML = `<span class="dl-btn-icon">✓</span> Download started`;
      setTimeout(() => { btn.disabled = false; btn.innerHTML = origHTML; }, 3000);
    }, 1000);

  } catch (err) {
    btn.disabled  = false;
    btn.innerHTML = origHTML;
    console.error('Download error:', err);
    window.open(`/api/download?url=${encodeURIComponent(videoUrl)}&format_id=${encodeURIComponent(formatId)}&format=${format}`, '_blank');
  }
}

/* ── DOWNLOAD PLAYLIST VIDEO (Individual) ── */
async function handlePlaylistVideoDownload(videoId, format) {
  // Find the video in current playlist
  const video = currentPlaylistData.videos.find(v => v.videoId === videoId);
  if (!video) return;

  // Create a temporary URL for this video
  const videoUrl = `https://youtube.com/watch?v=${videoId}`;
  
  try {
    const res = await fetch('/api/info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: videoUrl })
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error);

    // Find the best format for the requested type
    let selectedFormat = null;
    if (format === 'mp3') {
      selectedFormat = data.formats.find(f => f.ext === 'mp3');
    } else {
      selectedFormat = data.formats.find(f => f.ext === 'mp4' && f.quality === '720p') || 
                      data.formats.find(f => f.ext === 'mp4');
    }

    if (!selectedFormat) throw new Error('No suitable format found');

    const dlUrl = `/api/download?url=${encodeURIComponent(videoUrl)}&format_id=${encodeURIComponent(selectedFormat.formatId)}&format=${format}`;
    
    const a = document.createElement('a');
    a.href = dlUrl;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    
    setTimeout(() => {
      document.body.removeChild(a);
    }, 1000);

  } catch (err) {
    console.error('Playlist video download error:', err);
    showError(`Failed to download ${video.title}`);
  }
}

/* ── BULK DOWNLOAD PLAYLIST ── */
async function bulkDownloadPlaylist(format) {
  if (selectedPlaylistVideos.size === 0) {
    showError('Please select at least one video to download.');
    return;
  }

  const videoIds = Array.from(selectedPlaylistVideos);
  const bulkBtn = document.querySelector(`[data-bulk-action="${format}"]`);
  const origHTML = bulkBtn.innerHTML;

  bulkBtn.disabled = true;
  bulkBtn.innerHTML = `<span class="dl-btn-icon">⏳</span> Preparing…`;

  try {
    const res = await fetch('/api/bulk-download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ videoIds, format })
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error);

    // Download each file
    for (const download of data.downloads) {
      const a = document.createElement('a');
      a.href = download.url;
      a.download = `${download.title}.${format}`;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      
      setTimeout(() => {
        document.body.removeChild(a);
      }, 500);
    }

    bulkBtn.innerHTML = `<span class="dl-btn-icon">✓</span> Downloads started`;
    setTimeout(() => { bulkBtn.disabled = false; bulkBtn.innerHTML = origHTML; }, 3000);

  } catch (err) {
    bulkBtn.disabled = false;
    bulkBtn.innerHTML = origHTML;
    console.error('Bulk download error:', err);
    showError(err.message || 'Bulk download failed.');
  }
}

// Attach bulk download handlers (will be added to HTML)
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-bulk-action]')) {
    const format = e.target.closest('[data-bulk-action]').dataset.bulkAction;
    bulkDownloadPlaylist(format);
  }
});
