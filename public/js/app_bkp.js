/**
 * FetchWave — Frontend App
 * Handles input validation, API calls, result rendering, and downloads.
 */

/* ── DOM REFS ── */
const urlInput      = document.getElementById('urlInput');
const clearBtn      = document.getElementById('clearBtn');
const fetchBtn      = document.getElementById('fetchBtn');
const errorBanner   = document.getElementById('errorBanner');
const errorMsg      = document.getElementById('errorMsg');
const loaderSection = document.getElementById('loaderSection');
const resultsSection= document.getElementById('resultsSection');
const inputCard     = document.getElementById('inputCard');
const heroSection   = document.querySelector('.hero');
const qualityGrid   = document.getElementById('qualityGrid');
const qualityCount  = document.getElementById('qualityCount');
const metaTitle     = document.getElementById('metaTitle');
const metaThumb     = document.getElementById('metaThumb');
const metaDuration  = document.getElementById('metaDuration');
const metaChannel   = document.getElementById('metaChannel');
const resetBtn      = document.getElementById('resetBtn');

/* ── HELPERS ── */

/**
 * Extract a YouTube video ID from any standard YouTube URL.
 * Supports: youtube.com/watch?v=..., youtu.be/..., /shorts/...
 */
function extractVideoId(url) {
  try {
    const u = new URL(url.trim());
    if (u.hostname.includes('youtube.com')) {
      if (u.pathname.startsWith('/shorts/')) return u.pathname.split('/')[2];
      return u.searchParams.get('v') || null;
    }
    if (u.hostname === 'youtu.be') return u.pathname.slice(1).split('?')[0];
  } catch (_) {}
  return null;
}

/** Validate that input is a proper YouTube URL */
function validateInput(url) {
  if (!url.trim()) return 'Please enter a YouTube URL.';
  if (!extractVideoId(url)) return 'Could not parse a video ID from that URL. Please use a standard YouTube link.';
  return null;
}

/** Show an error message in the error banner */
function showError(msg) {
  errorMsg.textContent = msg;
  errorBanner.hidden = false;
}

/** Hide the error banner */
function hideError() {
  errorBanner.hidden = true;
}

/** Show/hide UI sections */
function setView(view) {
  loaderSection.hidden  = view !== 'loading';
  resultsSection.hidden = view !== 'results';
  if (view === 'results') heroSection.style.display = 'none';
  else heroSection.style.display = '';

  // Always hide error when switching views
  if (view === 'loading' || view === 'results') hideError();
}

/** Format file-size bytes to human-readable string */
function formatBytes(bytes) {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Format seconds to MM:SS or HH:MM:SS */
function formatDuration(seconds) {
  if (!seconds) return '';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  return `${m}:${String(s).padStart(2,'0')}`;
}

/* ── SHOW/HIDE CLEAR BUTTON ── */
urlInput.addEventListener('input', () => {
  clearBtn.classList.toggle('visible', urlInput.value.length > 0);
  if (errorBanner.hidden === false) hideError();
});

clearBtn.addEventListener('click', () => {
  urlInput.value = '';
  clearBtn.classList.remove('visible');
  urlInput.focus();
  hideError();
});

/* ── ENTER KEY SUPPORT ── */
urlInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') fetchBtn.click();
});

/* ── RESET BUTTON ── */
resetBtn.addEventListener('click', () => {
  urlInput.value = '';
  clearBtn.classList.remove('visible');
  hideError();
  setView('input');
  qualityGrid.innerHTML = '';
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

/* ── FETCH VIDEO INFO ── */
fetchBtn.addEventListener('click', async () => {
  const url = urlInput.value.trim();
  const validationError = validateInput(url);
  if (validationError) {
    showError(validationError);
    return;
  }

  hideError();
  fetchBtn.disabled = true;
  fetchBtn.querySelector('.fetch-btn-text').textContent = 'Fetching…';
  setView('loading');

  try {
    const res = await fetch('/api/info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });

    const data = await res.json();

    if (!res.ok || data.error) {
      throw new Error(data.error || 'Failed to fetch video information.');
    }

    renderResults(data);
    setView('results');
    window.scrollTo({ top: 0, behavior: 'smooth' });

  } catch (err) {
    setView('input');
    showError(err.message || 'An unexpected error occurred. Please try again.');
  } finally {
    fetchBtn.disabled = false;
    fetchBtn.querySelector('.fetch-btn-text').textContent = 'Fetch Video';
  }
});

/* ── RENDER RESULTS ── */
function renderResults(data) {
  // Meta
  metaTitle.textContent   = data.title || 'Unknown Title';
  metaThumb.src           = data.thumbnail || '';
  metaThumb.alt           = data.title || '';
  metaDuration.textContent= formatDuration(data.duration) || '—';
  metaChannel.textContent = data.channel || '—';

  // Formats
  const formats = data.formats || [];
  qualityCount.textContent = `${formats.length} format${formats.length !== 1 ? 's' : ''}`;

  qualityGrid.innerHTML = '';

  formats.forEach((fmt, i) => {
    const card = buildQualityCard(fmt, i);
    qualityGrid.appendChild(card);
  });
}

/* ── BUILD A QUALITY CARD ── */
function buildQualityCard(fmt, index) {
  const card = document.createElement('div');
  card.className = 'quality-card' + (fmt.isBest ? ' best' : '');
  card.style.animationDelay = `${index * 0.05}s`;

  // Determine format badge class
  const ext = (fmt.ext || 'mp4').toLowerCase();
  const badgeClass = ['mp4','webm','m4a','mp3'].includes(ext) ? ext : 'other';

  // Quality label
  const qualLabel = fmt.quality || fmt.resolution || (fmt.abr ? `${fmt.abr}kbps` : 'Unknown');

  // Type label
  const typeLabel = fmt.vcodec === 'none'
    ? 'Audio only'
    : fmt.acodec === 'none'
      ? 'Video only'
      : 'Video + Audio';

  // File size
  const sizeStr = formatBytes(fmt.filesize);

  // FPS
  const fpsStr = fmt.fps ? `${fmt.fps}fps` : '';

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
      ${fmt.vcodec && fmt.vcodec !== 'none' ? `<span class="meta-tag">${fmt.vcodec.split('.')[0]}</span>` : ''}
      ${fmt.acodec && fmt.acodec !== 'none' && fmt.vcodec !== 'none' ? `<span class="meta-tag">${fmt.acodec.split('.')[0]}</span>` : ''}
    </div>
    <button class="dl-btn" data-format-id="${fmt.formatId}" data-url="${encodeURIComponent(urlInput.value.trim())}">
      <span class="dl-btn-icon">↓</span>
      Download
    </button>
  `;

  // Wire download button
  card.querySelector('.dl-btn').addEventListener('click', handleDownload);
  return card;
}

/* ── HANDLE DOWNLOAD ── */
async function handleDownload(e) {
  const btn = e.currentTarget;
  const formatId = btn.dataset.formatId;
  const videoUrl = decodeURIComponent(btn.dataset.url);

  const origText = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<span class="dl-btn-icon">⏳</span> Preparing…`;

  try {
    // Build download URL pointing to our proxy endpoint
    const dlUrl = `/api/download?url=${encodeURIComponent(videoUrl)}&format_id=${encodeURIComponent(formatId)}`;

    // Trigger the browser download via a hidden anchor
    const a = document.createElement('a');
    a.href = dlUrl;
    a.download = '';  // filename supplied by Content-Disposition header
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    btn.innerHTML = `<span class="dl-btn-icon">✓</span> Download started`;
    setTimeout(() => {
      btn.disabled = false;
      btn.innerHTML = origText;
    }, 3000);

  } catch (err) {
    btn.disabled = false;
    btn.innerHTML = origText;
    alert('Download failed: ' + err.message);
  }
}

// Ensure clean state on page load
setView('input');
hideError();
