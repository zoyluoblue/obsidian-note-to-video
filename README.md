# Obsidian Note → Vertical Short Video

Turn any **Obsidian** note into a **faceless vertical short video** (9:16) ready for **TikTok, Instagram Reels, YouTube Shorts, and 小红书 (RED)** — with **local AI voiceover, auto images, animated captions, background music, and an auto-generated cover**. Runs locally on your Mac, free, no watermark.

> One note in → a finished 1080×1920 MP4 (plus a cover image) embedded right back into your note.

## What it does

1. **Script** — rewrites your note into a punchy spoken-word script (hook + short segments) via a cloud LLM (**DeepSeek / OpenAI**, OpenAI-compatible).
2. **Voiceover** — synthesizes narration **locally** with **Kokoro TTS** (via sherpa-onnx). Engine + model auto-download once, then fully offline — **no Python, no server**. Falls back to macOS `say`.
3. **Images** — auto-fetches a fitting image per segment from **Pexels** (by AI-generated keywords), or uses images embedded in your note / a folder. Adds **Ken Burns** zoom-pan and cross-fades between segments.
4. **Captions** — clean **single-line captions** at the bottom that follow the speech (animated, big, readable).
5. **Music** — optional **background music with automatic ducking** (music dips under the voice).
6. **Cover** — auto-generates a **小红书-style cover image** (title + first image) for the thumbnail / click-through.
7. **Render** — composites everything with **ffmpeg** into a 9:16 MP4 and embeds it in your note.

Everything except the text rewrite runs **on your machine** — no per-video fees, no watermark.

## Features

- 🎙️ Local neural **text-to-speech** — Kokoro (Apache-2.0), auto-downloaded, offline
- 🖼️ Auto **B-roll** from Pexels + Ken Burns + cross-fade (or bring your own images)
- 📝 Animated single-line captions
- 🎵 Background music with sidechain **ducking**
- 🪧 Auto **cover image** for 小红书 / thumbnails
- 📊 Live progress + one-click cancel, with graceful fallbacks
- 🔒 **Fully local rendering** (ffmpeg) — free, no watermark

## Requirements

- **macOS desktop** Obsidian (desktop-only; the Kokoro voice needs Apple Silicon)
- **ffmpeg** — `brew install ffmpeg`
- A **DeepSeek** or **OpenAI** API key (for the script step)
- *(optional)* a free **Pexels** API key (for auto images)

## Install (from source)

```bash
git clone https://github.com/zoyluoblue/obsidian-note-to-video
cd obsidian-note-to-video
npm install
npm run build        # outputs main.js
```

Copy `main.js`, `manifest.json`, `styles.css` into `<your-vault>/.obsidian/plugins/zoyclip/`, enable the plugin in Obsidian, fill in your API key in settings, then run the command **“把当前笔记做成竖屏短视频”** (Make a vertical short video from the current note) on any note.

## Settings

- **API** — base URL + model + key (DeepSeek `https://api.deepseek.com` / OpenAI `https://api.openai.com/v1`)
- **TTS** — Kokoro (local, auto-download) or system `say`; voice
- **Images** — Pexels API key (auto) — or an images folder / `![[note embeds]]` (manual)
- **Music** — a folder of tracks (random pick + ducking) + volume
- **Captions / background / cover** — style, gradient preset, cover on/off
- **ffmpeg path**

## How it stays local & free

- **Voiceover** runs locally via **Kokoro + sherpa-onnx** — no cloud TTS bills.
- **Rendering** uses native **ffmpeg** plus an in-app Canvas frame renderer that reuses Obsidian’s own Chromium — no second browser, no native-binary bundling.
- Only the **script rewrite** uses a cloud LLM (your own key); your audio/video never leave your machine.

## License

MIT (plugin). Dependencies keep their own licenses — Kokoro Apache-2.0, ffmpeg user-provided, Pexels images under the [Pexels License](https://www.pexels.com/license/).
