// M4：端到端编排。笔记 → 脚本 → 配音 → 字幕卡 → 合成 → 落库 + 嵌入笔记。

import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { FileSystemAdapter, Notice, TFile } from "obsidian";
import type ZoyClipPlugin from "../main";
import { checkFfmpeg, resolveTools } from "../ffmpeg";
import { ensureFfmpeg, ensureKokoroRuntime, kokoroSupported, KokoroRuntime } from "../runtime";
import { generateScript } from "./script";
import { synthesize, TtsBackend, TtsConfig } from "./tts";
import { renderCaptions } from "./captions";
import { BACKGROUNDS, compose } from "./compose";
import { renderCover, renderFrames } from "./framerender";
import { fetchPexelsImages } from "./images";

function toArrayBuffer(b: Buffer): ArrayBuffer {
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
}

function runtimeDirOf(plugin: ZoyClipPlugin): string {
  const adapter = plugin.app.vault.adapter;
  const base = adapter instanceof FileSystemAdapter ? adapter.getBasePath() : tmpdir();
  return join(base, plugin.app.vault.configDir, "plugins", plugin.manifest.id, "runtime");
}

const IMG_EXTS = new Set(["png", "jpg", "jpeg", "webp", "gif", "bmp", "avif"]);

/** 收集背景图：笔记内嵌图（![[..]] / ![](..)）+ 可选图片文件夹 → 绝对路径列表。 */
function collectImages(plugin: ZoyClipPlugin, file: TFile, raw: string, folder: string): string[] {
  const adapter = plugin.app.vault.adapter;
  const base = adapter instanceof FileSystemAdapter ? adapter.getBasePath() : "";
  const out: string[] = [];
  const add = (abs: string) => {
    if (abs && existsSync(abs) && !out.includes(abs)) out.push(abs);
  };
  for (const m of raw.matchAll(/!\[\[([^\]|#]+)[^\]]*\]\]/g)) {
    const dest = plugin.app.metadataCache.getFirstLinkpathDest(m[1].trim(), file.path);
    if (dest && IMG_EXTS.has(dest.extension.toLowerCase())) add(join(base, dest.path));
  }
  for (const m of raw.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)) {
    let p = m[1].trim();
    if (/^https?:/i.test(p)) continue;
    try {
      p = decodeURIComponent(p);
    } catch {
      /* keep raw */
    }
    if (IMG_EXTS.has((p.split(".").pop() || "").toLowerCase())) add(p.startsWith("/") ? p : join(base, p));
  }
  if (folder) {
    const dir = folder.startsWith("/") ? folder : join(base, folder);
    try {
      for (const fn of readdirSync(dir).sort()) {
        if (IMG_EXTS.has((fn.split(".").pop() || "").toLowerCase())) add(join(dir, fn));
      }
    } catch {
      /* 文件夹不存在/无权限 → 忽略 */
    }
  }
  return out;
}

const AUDIO_EXTS = new Set(["mp3", "wav", "m4a", "aac", "ogg", "flac", "opus"]);

/** 从音乐文件夹随机取一首（每条视频换一首），返回绝对路径或 undefined。 */
function pickMusic(plugin: ZoyClipPlugin, folder: string): string | undefined {
  if (!folder) return undefined;
  const adapter = plugin.app.vault.adapter;
  const base = adapter instanceof FileSystemAdapter ? adapter.getBasePath() : "";
  const dir = folder.startsWith("/") ? folder : join(base, folder);
  try {
    const files = readdirSync(dir).filter((fn) => AUDIO_EXTS.has((fn.split(".").pop() || "").toLowerCase()));
    if (!files.length) return undefined;
    return join(dir, files[Math.floor(Math.random() * files.length)]);
  } catch {
    return undefined;
  }
}

export async function produceVideo(plugin: ZoyClipPlugin, file: TFile): Promise<void> {
  const s = plugin.settings;
  if (!s.apiKey) {
    new Notice("请先在设置里填写 API Key。");
    return;
  }

  let tools = resolveTools(s.ffmpegPath);
  const ac = new AbortController();
  plugin.currentAbort = ac;
  const notice = new Notice("ZoyClip：准备中…\n（点此取消）", 0);
  notice.noticeEl.addEventListener("click", () => ac.abort());
  const setMsg = (m: string) => notice.setMessage(`ZoyClip：${m}\n（点此取消）`);
  let tmpDir = "";

  try {
    try {
      await checkFfmpeg(tools);
    } catch {
      // 系统无可用 ffmpeg → 自动下载静态版（仅首次），用户零配置
      const ff = await ensureFfmpeg(runtimeDirOf(plugin), setMsg);
      tools = { ...tools, ffmpeg: ff.ffmpeg, ffprobe: ff.ffprobe };
      await checkFfmpeg(tools);
    }

    setMsg("生成脚本…");
    const raw = await plugin.app.vault.cachedRead(file);
    // 英文版：脚本语言写死 en，确保与英文 Kokoro 模型匹配（避免中文脚本喂英文模型 → 配音退化重复）。
    const script = await generateScript(s, raw, "en");

    tmpDir = mkdtempSync(join(tmpdir(), "zoyclip-"));

    // 配音后端：kokoro 需本地运行时（首次自动下载）；不可用/下载失败 → 回退 say，不卡住出片。
    let backend: TtsBackend = s.ttsBackend;
    let runtime: KokoroRuntime | undefined;
    if (backend === "kokoro") {
      if (!kokoroSupported()) {
        new Notice("本地 Kokoro 仅支持 Apple Silicon，本次改用系统音色（say）。", 8000);
        backend = "system";
      } else {
        try {
          runtime = await ensureKokoroRuntime(runtimeDirOf(plugin), setMsg);
        } catch (e) {
          new Notice(`Kokoro 引擎准备失败，本次改用系统音色（say）。\n${e instanceof Error ? e.message : ""}`, 9000);
          backend = "system";
        }
      }
    }

    const cfg: TtsConfig = {
      backend,
      sayVoice: script.lang === "zh" ? s.voiceZh : s.voiceEn,
      runtime,
      sid: script.lang === "zh" ? s.kokoroSidZh : s.kokoroSidEn,
    };
    let tts;
    try {
      tts = await synthesize(tools, tmpDir, script, cfg, setMsg, ac.signal);
    } catch (e) {
      if (cfg.backend === "kokoro" && !ac.signal.aborted) {
        // Kokoro 合成异常 → 整片改用 say 重跑，保证出片（避免中途换嗓音的割裂感）。
        new Notice(`Kokoro 合成出错，本次改用系统音色（say）重试。\n${e instanceof Error ? e.message : ""}`, 8000);
        tts = await synthesize(tools, tmpDir, script, { ...cfg, backend: "system" }, setMsg, ac.signal);
      } else {
        throw e;
      }
    }

    const bgPreset = BACKGROUNDS.find((b) => b.id === s.background) ?? BACKGROUNDS[0];
    const toCss = (c: string) => "#" + c.replace(/^0x/i, "");
    let images: string[];
    if (s.pexelsApiKey) {
      const queries = script.segments.map((seg) => seg.image_query || seg.text);
      images = await fetchPexelsImages(s.pexelsApiKey, queries, tmpDir, setMsg, ac.signal);
    } else {
      images = collectImages(plugin, file, raw, s.imagesFolder);
    }
    setMsg(images.length ? `逐帧渲染（${images.length} 张图）…` : "逐帧渲染（渐变背景）…");
    let mp4: string;
    try {
      // 路线 B：Canvas 逐帧渲染（图片切换/Ken Burns + 逐词高亮 + 入场动画 + 动态波形），无需预渲染 PNG。
      mp4 = await renderFrames({
        tools,
        tmpDir,
        wavPath: tts.wavPath,
        script,
        timings: tts.timings,
        totalSeconds: tts.totalSeconds,
        bg: [toCss(bgPreset.c0), toCss(bgPreset.c1 ?? bgPreset.c0)],
        withWaveform: s.withWaveform,
        captionY: 1760,
        captionStyle: s.captionStyle,
        images,
        musicPath: pickMusic(plugin, s.musicFolder),
        musicVolume: s.musicVolume,
        signal: ac.signal,
        onProgress: (frac) => setMsg(`渲染 ${Math.round(frac * 100)}%…`),
      });
    } catch (e) {
      if (ac.signal.aborted) throw e; // 用户取消 → 不回退
      // 渲染层异常 → 回退到已验证的 ffmpeg 合成，保证出片。
      console.error("[ZoyClip] 逐帧渲染失败，回退 ffmpeg 合成", e);
      new Notice("逐帧渲染出错，本次回退到 ffmpeg 合成。", 6000);
      const captions = await renderCaptions(tmpDir, script, tts.timings, { fontSize: 64, maxWidth: 920, lang: script.lang });
      mp4 = await compose({
        tools,
        tmpDir,
        wavPath: tts.wavPath,
        captions,
        totalSeconds: tts.totalSeconds,
        bg: bgPreset,
        withWaveform: s.withWaveform,
        captionY: 760,
      });
    }

    setMsg("写入笔记…");
    const base = file.basename.replace(/[\\/:*?"<>|]/g, "_");
    const attachPath = await plugin.app.fileManager.getAvailablePathForAttachment(`${base}-short.mp4`);
    const mp4File = await plugin.app.vault.createBinary(attachPath, toArrayBuffer(readFileSync(mp4)));
    await plugin.app.vault.append(file, `\n\n![[${mp4File.path}]]\n`);

    if (s.makeCover) {
      try {
        setMsg("生成封面…");
        const coverTmp = join(tmpDir, "cover.png");
        await renderCover({
          title: script.title,
          imagePath: images[0],
          bg: [toCss(bgPreset.c0), toCss(bgPreset.c1 ?? bgPreset.c0)],
          outPath: coverTmp,
        });
        const coverPath = await plugin.app.fileManager.getAvailablePathForAttachment(`${base}-cover.png`);
        const coverFile = await plugin.app.vault.createBinary(coverPath, toArrayBuffer(readFileSync(coverTmp)));
        await plugin.app.vault.append(file, `![[${coverFile.path}]]\n`);
      } catch (e) {
        console.error("[ZoyClip] 封面生成失败", e);
      }
    }

    notice.hide();
    new Notice(`✅ 出片完成（约 ${Math.round(tts.totalSeconds)}s），已嵌入「${file.basename}」。`, 6000);
  } catch (e) {
    notice.hide();
    const msg = e instanceof Error ? e.message : String(e);
    if (ac.signal.aborted || msg === "已取消") {
      new Notice("已取消出片。", 4000);
    } else {
      new Notice(`出片失败：${msg}`, 9000);
      console.error("[ZoyClip]", e);
    }
  } finally {
    plugin.currentAbort = undefined;
    if (tmpDir) {
      try {
        rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  }
}
