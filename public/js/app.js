/**
 * FetchWave — Frontend App
 */

const urlInput       = document.getElementById('urlInput');
const clearBtn       = document.getElementById('clearBtn');
const fetchBtn       = document.getElementById('fetchBtn');
const errorBanner    = document.getElementById('errorBanner');
const errorMsg       = document.getElementById('errorMsg');
const loaderSection  = document.getElementById('loaderSection');
const resultsSection = document.getElementById('resultsSection');
const heroSection    = document.querySelector('.hero');
const qualityGrid    = document.getElementById('qualityGrid');
const qualityCount   = document.getElementById('qualityCount');
const metaTitle      = document.getElementById('metaTitle');
const metaThumb      = document.getElementById('metaThumb');
const metaDuration   = document.getElementById('metaDuration');
const metaChannel    = document.getElementById('metaChannel');
const resetBtn       = document.getElementById('resetBtn');

/* ── INIT: ensure clean state on load ── */
loaderSection.style.display  = 'none';
resultsSection.style.display = 'none';
errorBanner.style.display    = 'none';

/* ── HELPERS ── */
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

function validateInput(url) {
  if (!url.trim()) return 'Please enter a YouTube URL.';
  if (!extractVideoId(url)) return 'Could not parse a video ID. Please use a standard YouTube link.';
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
  heroSection.style.display    = view === 'results' ? 'none'  : '';
  if (view === 'loading' || view === 'results') hideError();
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

    renderResults(data);
    setView('results');
    window.scrollTo({ top: 0, behavior: 'smooth' });

  } catch (err) {
    setView('input');
    showError(err.message || 'An unexpected error occurred.');
  } finally {
    fetchBtn.disabled = false;
    fetchBtn.querySelector('.fetch-btn-text').textContent = 'Fetch Video';
  }
});

/* ── RENDER RESULTS ── */
function renderResults(data) {
  metaTitle.textContent    = data.title     || 'Unknown Title';
  metaThumb.src            = data.thumbnail || '';
  metaThumb.alt            = data.title     || '';
  metaDuration.textContent = formatDuration(data.duration) || '—';
  metaChannel.textContent  = data.channel   || '—';

  const formats = data.formats || [];
  qualityCount.textContent = `${formats.length} format${formats.length !== 1 ? 's' : ''}`;
  qualityGrid.innerHTML = '';
  formats.forEach((fmt, i) => qualityGrid.appendChild(buildQualityCard(fmt, i)));
}

/* ── BUILD QUALITY CARD ── */
function buildQualityCard(fmt, index) {
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
      data-url="${encodeURIComponent(urlInput.value.trim())}">
      <span class="dl-btn-icon">↓</span>
      Download
    </button>
  `;

  card.querySelector('.dl-btn').addEventListener('click', handleDownload);
  return card;
}

/* ── DOWNLOAD ── */
async function handleDownload(e) {
  const btn      = e.currentTarget;
  const formatId = btn.dataset.formatId;
  const videoUrl = decodeURIComponent(btn.dataset.url);
  const origHTML = btn.innerHTML;

  btn.disabled  = true;
  btn.innerHTML = `<span class="dl-btn-icon">⏳</span> Preparing…`;

  try {
    const dlUrl = `/api/download?url=${encodeURIComponent(videoUrl)}&format_id=${encodeURIComponent(formatId)}`;
    
    /**
     * PROXY DOWNLOAD FIX:
     * We use a hidden <a> link to trigger the download from our server proxy.
     * Our server now sends 'Content-Disposition: attachment', which FORCES
     * the browser to download instead of playing.
     */
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
    window.open(`/api/download?url=${encodeURIComponent(videoUrl)}&format_id=${encodeURIComponent(formatId)}`, '_blank');
  }
}
