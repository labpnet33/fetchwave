# ⌁ FetchWave

> Download YouTube videos in any quality — fast, clean, free.

![FetchWave Screenshot](https://via.placeholder.com/860x480/080a0f/00e5ff?text=FetchWave)

---

## ✨ Features

- 🔗 **Paste any YouTube URL** — watch links, shorts, music videos
- 🎚️ **All quality options** displayed — from 144p to 4K + audio-only
- ⭐ **Best format highlighted** — clearly shows the highest combined stream
- ⬇️ **Direct streaming download** — via yt-dlp piped to your browser
- 📱 **Fully responsive** — works on mobile and desktop
- 🚫 **No ads, no signup** — completely free

---

## 🚀 Quick Start

### Prerequisites

- **Node.js** ≥ 18
- **[yt-dlp](https://github.com/yt-dlp/yt-dlp)** installed on your system

### Install yt-dlp

```bash
# macOS (Homebrew)
brew install yt-dlp

# Linux
sudo curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp
sudo chmod a+rx /usr/local/bin/yt-dlp

# Windows (winget)
winget install yt-dlp
```

### Run locally

```bash
git clone https://github.com/YOUR_USERNAME/fetchwave.git
cd fetchwave
npm install
npm start
# → Open http://localhost:3000
```

For hot-reload during development:
```bash
npm run dev
```

---

## 📁 Project Structure

```
fetchwave/
├── server.js          # Express entry point
├── api/
│   └── ytdlp.js       # yt-dlp wrapper — route handlers for /info & /download
├── public/
│   ├── index.html     # Single-page frontend
│   ├── css/
│   │   └── style.css  # All styles (dark industrial aesthetic)
│   └── js/
│       └── app.js     # Frontend logic (fetch, render, download)
├── bin/               # (optional) bundle yt-dlp binary for Vercel
│   └── yt-dlp         # ← place binary here for serverless deploys
├── vercel.json        # Vercel deployment config
├── package.json
└── README.md
```

---

## ☁️ Deploy to Vercel

### Option A — System yt-dlp (not available on Vercel serverless)

Vercel's serverless functions don't have `yt-dlp` pre-installed. Use Option B.

### Option B — Bundle the binary (recommended)

1. Download the Linux binary from [yt-dlp releases](https://github.com/yt-dlp/yt-dlp/releases/latest):

```bash
mkdir -p bin
curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp \
  -o bin/yt-dlp
chmod +x bin/yt-dlp
```

2. Set the environment variable in `vercel.json` (already done):

```json
{
  "env": {
    "YTDLP_PATH": "./bin/yt-dlp"
  }
}
```

3. Deploy:

```bash
npm i -g vercel
vercel --prod
```

> **Note:** Vercel **Hobby** enforces a **10-second** serverless limit — long downloads will be cut off. Use **Vercel Pro** (this repo sets `maxDuration: 300` in `vercel.json` for `server.js`) or deploy on a **VPS / Railway / Render / Fly.io** for reliable large-file streaming.

### Downloads: quality, redirects, and merge

- **Streaming uses axios** with **HTTP redirects followed** (Node’s raw `https` client does not follow redirects, which used to save tiny HTML/error bodies as “.mp4”). Requests use **`Referer: https://www.youtube.com/watch?v=VIDEO_ID`** (required by the CDN; a generic referer often returns **403**). If the CDN still returns **403**, the server **falls back to `@distube/ytdl-core`** for the same format.
- **“Best merged (max quality + audio)”** (`format_id=__MERGE_BEST__`) combines the **best adaptive video** and **best adaptive audio** with **ffmpeg** (`-c copy`) so you get **4K/HDR-style** quality with audio when YouTube splits streams. Requires **ffmpeg** on the server (see `FFMPEG_PATH` or bundled **`ffmpeg-static`** from npm).
- **Lower rows** are **progressive/muxed** MP4s (e.g. 360p, 720p) when the API exposes them.
- **Optional:** **`?direct=1`** returns a **302** to the CDN URL. Often unreliable in browsers; prefer the default proxied stream.

### Option C — Railway / Render / Fly.io (recommended for large files)

These platforms support long-running processes and larger responses. Just set:
```
YTDLP_PATH=yt-dlp   # if yt-dlp is in PATH
```
and deploy the repo normally.

---

## ⚙️ Environment Variables

| Variable         | Default   | Description |
|------------------|-----------|-------------|
| `PORT`           | `3000`    | HTTP port for the Express server |
| `RAPID_API_KEY`  | —         | RapidAPI key for `yt-api.p.rapidapi.com` (required for `/api/info` and `/api/download`) |
| `YTDLP_PATH`     | `yt-dlp`  | Path to yt-dlp binary (optional; legacy docs) |
| `MAX_DURATION`   | `10800`   | Max video duration in seconds (3 hours) |
| `FFMPEG_PATH`    | (auto)    | Path to `ffmpeg` for merged downloads; otherwise **`ffmpeg-static`** from npm is used |

---

## 🛡️ Legal Notice

FetchWave is intended for **personal, offline use only** of content you have the right to download (e.g. your own uploads, content under Creative Commons, or videos explicitly licensed for download).

Downloading copyrighted material without permission may violate:
- [YouTube's Terms of Service](https://www.youtube.com/t/terms) (Section 5.H)
- Local copyright laws

The authors of FetchWave are not responsible for misuse.

---

## 🤝 Contributing

PRs welcome! Please open an issue first for major changes.

---

## 📄 License

MIT © FetchWave contributors
