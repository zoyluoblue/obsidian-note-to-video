# ZoyClip — Note → Vertical Short Video

[English](README.md) | [中文](README.zh-CN.md)

Turn any note into a faceless **9:16 vertical short video** for **TikTok, Instagram Reels, YouTube Shorts and 小红书 (RED)** — with local AI voiceover, auto images, animated captions, background music, and an auto-generated cover. **Bilingual (English / 中文).** Runs locally, free, no watermark.

> One note in → a finished 1080×1920 MP4 (plus a cover image) embedded right back into your note.

## What it does

1. **Script** — rewrites your note into a punchy spoken-word script (hook + short segments) via a cloud LLM (**OpenAI** or **DeepSeek**, OpenAI-compatible).
2. **Voiceover** — synthesizes narration **locally** with **Kokoro TTS** (via sherpa-onnx), English and Chinese. Engine + model auto-download once, then fully offline — no Python, no server. Falls back to the system voice.
3. **Images** — auto-fetches a fitting photo per segment from **Pexels** (by AI-generated keywords), or uses images embedded in your note / a folder. Adds Ken Burns zoom-pan and cross-fades.
4. **Captions** — clean single-line captions that follow the speech (animated, big, readable; CJK-aware).
5. **Music** — optional background music with automatic ducking (music dips under the voice).
6. **Cover** — auto-generates a cover image (title + first image) for the thumbnail / click-through.
7. **Render** — composites everything with **ffmpeg** into a 9:16 MP4 and embeds it in your note.

## Language

Switch the whole plugin — the UI **and** the generated video (script, captions, voiceover) — between **English** and **中文** in settings. Default **Auto** follows your Obsidian UI language.

## Privacy & network use

ZoyClip is local-first. Every network call below is triggered by you when you produce a video — none for analytics or telemetry:

- **Cloud LLM (required).** Your note's text is sent to the LLM endpoint you configure (**OpenAI** `api.openai.com`, **DeepSeek** `api.deepseek.com`, or any OpenAI-compatible URL you enter) using **your own API key**, to rewrite it into a script. This is the only step that sends your note content off your machine.
- **Pexels (optional).** If you add a Pexels API key, short English image keywords (not your note text) are sent to `api.pexels.com` to fetch stock photos.
- **One-time downloads of open-source tools** from public GitHub Releases, then run locally via Node `child_process`:
  - **ffmpeg** static binary — from [`eugeneware/ffmpeg-static`](https://github.com/eugeneware/ffmpeg-static) (macOS only; or use your own ffmpeg via the path setting).
  - **sherpa-onnx** TTS engine + **Kokoro** voice models — from [`k2-fsa/sherpa-onnx`](https://github.com/k2-fsa/sherpa-onnx).
  These are cached in the plugin folder and reused offline. No code that becomes part of the plugin is ever downloaded.
- **Temporary files.** During rendering, the plugin writes temporary audio/frames to your system temp folder and deletes them when finished.

No analytics, no telemetry, no ads. Your generated audio and video never leave your machine.

## Requirements

- **Desktop** Obsidian (desktop-only — uses Node/Electron APIs; `isDesktopOnly`).
- **Apple Silicon Mac** for the local Kokoro voice (other platforms fall back to the system voice).
- **ffmpeg** — auto-downloaded on first use on macOS, or set its path in settings / `brew install ffmpeg`.
- An **OpenAI** or **DeepSeek** API key (for the script step).
- *(optional)* a free **Pexels** API key (for auto images) — get one at [pexels.com/api](https://www.pexels.com/api/).

## Install

**From the community store** (once published): Settings → Community plugins → Browse → search **ZoyClip**.

**From source / BRAT:**

```bash
git clone https://github.com/zoyluoblue/obsidian-note-to-video
cd obsidian-note-to-video
npm install
npm run build        # outputs main.js
```

Copy `main.js`, `manifest.json`, `styles.css` into `<your-vault>/.obsidian/plugins/zoyclip/`, enable the plugin in Obsidian, add your API key in settings, then run the command **"Turn this note into a vertical short video"** on any note.

## Settings

- **Language** — Auto (follow Obsidian) / English / 中文 — switches UI **and** output.
- **LLM** — provider (OpenAI / DeepSeek), Base URL, model, API key.
- **Voice** — Kokoro voice id (audition by changing and re-rendering).
- **Captions** — TikTok (big words, pop-in) or full-sentence style.
- **Images** — Pexels API key (auto) — or an images folder / `![[note embeds]]` (manual).
- **Music** — a folder of tracks (random pick + ducking) + volume.
- **Cover** — generate a cover image on/off.
- **Preview** — edit the script + image keywords before rendering.
- **ffmpeg path** — optional (auto-detected / auto-downloaded otherwise).

## How it stays local & free

- **Voiceover** runs locally via **Kokoro + sherpa-onnx** — no cloud TTS bills.
- **Rendering** uses native **ffmpeg** plus an in-app Canvas frame renderer that reuses Obsidian's own Chromium — no second browser, no native-binary bundling.
- Only the **script rewrite** uses a cloud LLM (your own key); your audio and video never leave your machine.

## License

MIT — see [LICENSE](LICENSE). Third-party components keep their own licenses: **Kokoro** (Apache-2.0), **sherpa-onnx** (Apache-2.0), **ffmpeg** (downloaded static build, LGPL/GPL per build), and Pexels images under the [Pexels License](https://www.pexels.com/license/).
