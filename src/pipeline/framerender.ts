// 路线 B：逐帧 Canvas 渲染 → stdin 管道喂 ffmpeg 编码。跑在 Obsidian 渲染层（DOM Canvas + Node）。
// 效果：① 图片切换 + Ken Burns（缩放平移）+ 交叉淡化  ② 逐词卡拉OK高亮  ③ 字幕淡入上移入场。
// 无图则回退动画渐变背景。已实测：逐帧 RGBA → ffmpeg rawvideo 管道 ≈ 9× 实时。

import { spawn } from "child_process";
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import type { ToolPaths } from "../ffmpeg";
import type { ShortScript } from "../types";
import type { SegTiming } from "./tts";

const W = 1080;
const H = 1920;
const CROSSFADE = 0.45; // 段间图片交叉淡化时长(秒)
const EXTRA_PATHS = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"];

function procEnv(): NodeJS.ProcessEnv {
  return { ...process.env, PATH: EXTRA_PATHS.join(":") + ":" + (process.env.PATH || "") };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** 含中日韩字符或全角标点（这类文本无空格，需按字符断行 + CJK 字体）。 */
function hasCJK(s: string): boolean {
  return /[　-〿㐀-鿿぀-ヿ가-힯]/.test(s);
}

// 字幕/封面字体栈：拉丁优先，后接中日韩字体（macOS PingFang / 旧版 Hiragino / Windows 雅黑），保证中文不出豆腐块。
const FONT_STACK = `"Helvetica Neue", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", Arial, sans-serif`;

export interface FrameRenderOpts {
  tools: ToolPaths;
  tmpDir: string;
  wavPath: string;
  script: ShortScript;
  timings: SegTiming[];
  totalSeconds: number;
  bg: [string, string];
  withWaveform: boolean;
  captionY: number;
  /** 字幕风格：tiktok=少字大字逐块弹出 / sentence=整句逐词高亮 */
  captionStyle: "tiktok" | "sentence";
  /** 图片绝对路径池；空=用动画渐变背景。每段按顺序取一张（不足则循环） */
  images: string[];
  /** 背景音乐绝对路径（可选）；提供则混入并对人声 ducking */
  musicPath?: string;
  /** 背景音乐音量 0..1（ducking 前的基准音量） */
  musicVolume?: number;
  /** 取消信号：aborted 时 kill ffmpeg 并中止 */
  signal?: AbortSignal;
  /** 渲染进度回报 0..1 */
  onProgress?: (frac: number) => void;
  fps?: number;
}

function readAmplitudes(tools: ToolPaths, wavPath: string, frames: number, fps: number): Promise<Float32Array> {
  return new Promise((resolve, reject) => {
    const sr = 24000;
    const child = spawn(
      tools.ffmpeg,
      ["-hide_banner", "-loglevel", "error", "-i", wavPath, "-f", "s16le", "-ac", "1", "-ar", String(sr), "pipe:1"],
      { env: procEnv() }
    );
    const chunks: Buffer[] = [];
    child.stdout.on("data", (d: Buffer) => chunks.push(d));
    child.on("error", reject);
    child.on("close", () => {
      const buf = Buffer.concat(chunks);
      const samples = new Int16Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 2));
      const per = Math.max(1, Math.floor(sr / fps));
      const amps = new Float32Array(frames);
      let peak = 1e-6;
      for (let f = 0; f < frames; f++) {
        let sum = 0;
        const s0 = f * per;
        for (let i = 0; i < per; i++) {
          const v = samples[s0 + i] || 0;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / per) / 32768;
        amps[f] = rms;
        if (rms > peak) peak = rms;
      }
      for (let f = 0; f < frames; f++) amps[f] = Math.min(1, amps[f] / peak);
      resolve(amps);
    });
  });
}

/** t 落在哪段「说话」时段（不含段尾停顿）。-1=不在任何说话段。 */
function segAt(timings: SegTiming[], t: number): number {
  for (let i = 0; i < timings.length; i++) if (t >= timings[i].start && t < timings[i].end) return i;
  return -1;
}

/** 最近一段（含停顿期仍归属上一段，供背景图保持连续）。 */
function lastSeg(timings: SegTiming[], t: number): number {
  let idx = 0;
  for (let i = 0; i < timings.length; i++) if (timings[i].start <= t) idx = i;
  return idx;
}

function loadImages(paths: string[]): Promise<HTMLImageElement[]> {
  return Promise.all(
    paths.map(
      (p) =>
        new Promise<HTMLImageElement | null>((resolve) => {
          try {
            const ext = (p.split(".").pop() || "").toLowerCase();
            const mime =
              ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : ext === "gif" ? "image/gif" : "image/jpeg";
            const b64 = readFileSync(p).toString("base64");
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = () => resolve(null);
            img.src = `data:${mime};base64,${b64}`;
          } catch {
            resolve(null);
          }
        })
    )
  ).then((arr) => arr.filter((x): x is HTMLImageElement => !!x));
}

function drawCover(ctx: CanvasRenderingContext2D, img: HTMLImageElement, kb: number): void {
  // 铺满 1080x1920 + Ken Burns：随 kb(0..1) 缓慢放大并平移。
  const base = Math.max(W / img.width, H / img.height);
  const scale = base * (1 + 0.1 * kb);
  const dw = img.width * scale;
  const dh = img.height * scale;
  ctx.drawImage(img, (W - dw) / 2 - 24 * kb, (H - dh) / 2 - 36 * kb, dw, dh);
}

function hex(c: string): [number, number, number] {
  const m = c.replace("#", "");
  return [parseInt(m.slice(0, 2), 16), parseInt(m.slice(2, 4), 16), parseInt(m.slice(4, 6), 16)];
}
function mix(a: string, b: string, k: number): string {
  const pa = hex(a);
  const pb = hex(b);
  return `rgb(${Math.round(pa[0] + (pb[0] - pa[0]) * k)},${Math.round(pa[1] + (pb[1] - pa[1]) * k)},${Math.round(
    pa[2] + (pb[2] - pa[2]) * k
  )})`;
}

export async function renderFrames(o: FrameRenderOpts): Promise<string> {
  const fps = o.fps ?? 30;
  const frames = Math.max(1, Math.ceil(o.totalSeconds * fps));
  const out = join(o.tmpDir, "out_9x16.mp4");
  const amps = o.withWaveform ? await readAmplitudes(o.tools, o.wavPath, frames, fps) : new Float32Array(frames);
  const imgs = o.images.length ? await loadImages(o.images) : [];

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Cannot create a Canvas 2D context");

  // 输入：0=rawvideo 管道，1=旁白 wav，(可选)2=背景音乐(循环)
  const args: string[] = [
    "-y", "-hide_banner", "-loglevel", "error",
    "-f", "rawvideo", "-pix_fmt", "rgba", "-s", `${W}x${H}`, "-r", String(fps), "-i", "pipe:0",
    "-i", o.wavPath,
  ];
  if (o.musicPath) {
    const vol = (o.musicVolume ?? 0.22).toFixed(3);
    args.push(
      "-stream_loop", "-1", "-i", o.musicPath,
      "-filter_complex",
      `[2:a]aresample=24000,aformat=channel_layouts=mono,volume=${vol}[m];` +
        `[1:a]asplit=2[sc][voice];` +
        `[m][sc]sidechaincompress=threshold=0.05:ratio=8:attack=20:release=300[ducked];` +
        `[voice][ducked]amix=inputs=2:duration=first:normalize=0[aout]`,
      "-map", "0:v", "-map", "[aout]"
    );
  } else {
    args.push("-map", "0:v", "-map", "1:a");
  }
  args.push(
    "-shortest",
    "-c:v", "libx264", "-profile:v", "high", "-pix_fmt", "yuv420p", "-crf", "19",
    "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", out
  );
  const ff = spawn(o.tools.ffmpeg, args, { env: procEnv() });
  let ffErr = "";
  ff.stderr.on("data", (d: Buffer) => (ffErr = (ffErr + d.toString()).slice(-500)));
  const ffDone = new Promise<void>((resolve, reject) => {
    ff.on("error", reject);
    ff.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited with code ${code}: ${ffErr}`))));
  });
  const write = (buf: Buffer): Promise<void> =>
    new Promise((res) => (ff.stdin.write(buf) ? res() : ff.stdin.once("drain", res)));

  for (let f = 0; f < frames; f++) {
    if (o.signal?.aborted) {
      ff.kill("SIGKILL");
      throw new Error("Canceled");
    }
    const t = f / fps;
    drawBackground(ctx, t, f, amps, imgs, o);
    drawCaption(ctx, t, o);
    const img = ctx.getImageData(0, 0, W, H);
    await write(Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength));
    if (f % 15 === 0) o.onProgress?.(f / frames);
  }
  o.onProgress?.(1);
  ff.stdin.end();
  await ffDone;
  return out;
}

function drawBackground(
  ctx: CanvasRenderingContext2D,
  t: number,
  f: number,
  amps: Float32Array,
  imgs: HTMLImageElement[],
  o: FrameRenderOpts
): void {
  if (imgs.length) {
    // ① 图片背景 + Ken Burns + 段间交叉淡化
    const si = lastSeg(o.timings, t);
    const seg = o.timings[si];
    const dur = Math.max(0.1, seg.end - seg.start);
    const kb = clamp((t - seg.start) / dur, 0, 1.2);
    drawCover(ctx, imgs[si % imgs.length], kb);
    // 临近段尾 → 淡入下一段的图
    if (si < o.timings.length - 1 && t > seg.end - CROSSFADE) {
      const a = clamp((t - (seg.end - CROSSFADE)) / CROSSFADE, 0, 1);
      ctx.save();
      ctx.globalAlpha = a;
      drawCover(ctx, imgs[(si + 1) % imgs.length], 0);
      ctx.restore();
    }
    // 暗化蒙版：底部加深，保证白字幕可读
    const sc = ctx.createLinearGradient(0, 0, 0, H);
    sc.addColorStop(0, "rgba(0,0,0,0.30)");
    sc.addColorStop(0.5, "rgba(0,0,0,0.15)");
    sc.addColorStop(1, "rgba(0,0,0,0.62)");
    ctx.fillStyle = sc;
    ctx.fillRect(0, 0, W, H);
  } else {
    // 无图：动画渐变
    const shift = clamp(Math.sin(t * 0.6) * 0.04 + 0.5, 0.05, 0.95);
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, o.bg[0]);
    grad.addColorStop(shift, mix(o.bg[0], o.bg[1], 0.5));
    grad.addColorStop(1, o.bg[1]);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
  }

  // 波形
  if (o.withWaveform) {
    const bars = 48;
    const bw = 14;
    const gap = 6;
    const totalW = bars * bw + (bars - 1) * gap;
    const x0 = (W - totalW) / 2;
    const cy = 1810; // 移到最底部，避开下方字幕
    ctx.fillStyle = "rgba(150,210,255,0.85)";
    for (let i = 0; i < bars; i++) {
      const idx = clamp(f - bars + i * 2, 0, amps.length - 1);
      const h = 6 + (amps[idx] || 0) * 150;
      ctx.fillRect(x0 + i * (bw + gap), cy - h / 2, bw, h);
    }
  }
}

function drawCaption(ctx: CanvasRenderingContext2D, t: number, o: FrameRenderOpts): void {
  if (o.captionStyle === "sentence") drawCaptionSentence(ctx, t, o);
  else drawCaptionTikTok(ctx, t, o);
}

/** 把整段折成「单行」片段（每行 ≤ maxChars），供逐行显示。中文按字符断行，拉丁按词断行。 */
function wrapLines(text: string, maxChars: number): string[] {
  const t = text.trim();
  if (!t) return [];
  if (hasCJK(t)) {
    // 中文无空格：按字符断行；CJK 字宽约拉丁 2×，故每行字数减半。
    const per = Math.max(6, Math.floor(maxChars / 2));
    const chars = [...t.replace(/\s+/g, "")];
    const lines: string[] = [];
    for (let i = 0; i < chars.length; i += per) lines.push(chars.slice(i, i + per).join(""));
    return lines.length ? lines : [t];
  }
  const words = t.replace(/\s+/g, " ").split(" ").filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const tentative = cur ? cur + " " + w : w;
    if (cur && tentative.length > maxChars) {
      lines.push(cur);
      cur = w;
    } else {
      cur = tentative;
    }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [t];
}

/** 整句字幕：每次只显示一行（整段按字符权重逐行推进），全白无高亮，底部居中。 */
function drawCaptionSentence(ctx: CanvasRenderingContext2D, t: number, o: FrameRenderOpts): void {
  const si = segAt(o.timings, t);
  if (si < 0) return; // 停顿期不显示
  const seg = o.script.segments[si];
  const segStart = o.timings[si].start;
  const dur = Math.max(0.1, o.timings[si].end - segStart);
  const localT = t - segStart;

  const lines = wrapLines(seg.text, 26);
  const lens = lines.map((l) => Math.max(1, l.length));
  const totalLen = lens.reduce((a, b) => a + b, 0);
  const startFrac: number[] = [];
  let acc = 0;
  for (let i = 0; i < lines.length; i++) {
    startFrac[i] = acc / totalLen;
    acc += lens[i];
  }
  const p = clamp(localT / dur, 0, 0.9999);
  let li = lines.length - 1;
  for (let i = 0; i < lines.length; i++) {
    const end = i + 1 < lines.length ? startFrac[i + 1] : 1;
    if (p < end) {
      li = i;
      break;
    }
  }
  const text = lines[li];

  // 每行独立淡入
  const lineStartT = segStart + startFrac[li] * dur;
  const alpha = clamp((t - lineStartT) / 0.18, 0, 1);

  const fontOf = (px: number) => `700 ${px}px ${FONT_STACK}`;
  let fs = 72;
  ctx.font = fontOf(fs);
  while (ctx.measureText(text).width > 1000 && fs > 44) {
    fs -= 4;
    ctx.font = fontOf(fs);
  }

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = fontOf(fs);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.lineWidth = Math.max(10, Math.round(fs * 0.2));
  ctx.strokeStyle = "rgba(0,0,0,0.92)";
  ctx.fillStyle = "#ffffff"; // 全白，无逐词高亮
  ctx.shadowColor = "rgba(0,0,0,0.5)";
  ctx.shadowBlur = 10;
  ctx.shadowOffsetY = 3;
  ctx.strokeText(text, W / 2, o.captionY);
  ctx.fillText(text, W / 2, o.captionY);
  ctx.restore();
}

function easeOutBack(x: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
}

/** 把整段切成 1–3 词的小块（TikTok 风），去句末标点。中文按 ~6 字一块。 */
function chunkText(text: string): string[] {
  const t = text.trim();
  if (hasCJK(t)) {
    const chars = [...t.replace(/\s+/g, "")].filter((c) => !/[，。；：！？、,.;:!?—…]/.test(c));
    const chunks: string[] = [];
    for (let i = 0; i < chars.length; i += 6) chunks.push(chars.slice(i, i + 6).join(""));
    return chunks.length ? chunks : [t];
  }
  const words = t.replace(/\s+/g, " ").split(" ").filter(Boolean);
  const chunks: string[] = [];
  let cur = "";
  let n = 0;
  const flush = () => {
    const c = cur.replace(/[,.;:!?—]+$/g, "").trim();
    if (c) chunks.push(c);
    cur = "";
    n = 0;
  };
  for (const w of words) {
    const tentative = cur ? cur + " " + w : w;
    if (cur && (n >= 3 || tentative.length > 18)) flush();
    cur = cur ? cur + " " + w : w;
    n++;
    if (/[,.!?;:—]$/.test(w)) flush();
  }
  flush();
  return chunks.length ? chunks : [text.trim()];
}

/** TikTok 风：当前小块大字居中、弹入(scale+fade)，按字符权重分配时间。 */
function drawCaptionTikTok(ctx: CanvasRenderingContext2D, t: number, o: FrameRenderOpts): void {
  const si = segAt(o.timings, t);
  if (si < 0) return;
  const seg = o.script.segments[si];
  const segStart = o.timings[si].start;
  const dur = Math.max(0.1, o.timings[si].end - segStart);
  const localT = t - segStart;

  const chunks = chunkText(seg.text);
  const lens = chunks.map((c) => Math.max(1, c.length));
  const total = lens.reduce((a, b) => a + b, 0);
  const startFrac: number[] = [];
  let acc = 0;
  for (let i = 0; i < chunks.length; i++) {
    startFrac[i] = acc / total;
    acc += lens[i];
  }
  const p = clamp(localT / dur, 0, 0.9999);
  let ci = chunks.length - 1;
  for (let i = 0; i < chunks.length; i++) {
    const end = i + 1 < chunks.length ? startFrac[i + 1] : 1;
    if (p < end) {
      ci = i;
      break;
    }
  }

  const text = chunks[ci];
  const lct = t - (segStart + startFrac[ci] * dur);
  const scale = 0.8 + 0.2 * easeOutBack(clamp(lct / 0.13, 0, 1));
  const alpha = clamp(lct / 0.08, 0, 1);

  const fontOf = (px: number) => `800 ${px}px ${FONT_STACK}`;
  let fs = 124;
  ctx.font = fontOf(fs);
  while (ctx.measureText(text).width > 900 && fs > 56) {
    fs -= 6;
    ctx.font = fontOf(fs);
  }

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(W / 2, o.captionY);
  ctx.scale(scale, scale);
  ctx.font = fontOf(fs);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.lineWidth = Math.max(10, fs * 0.14);
  ctx.strokeStyle = "rgba(0,0,0,0.92)";
  ctx.fillStyle = "#ffffff";
  ctx.shadowColor = "rgba(0,0,0,0.5)";
  ctx.shadowBlur = 12;
  ctx.shadowOffsetY = 4;
  ctx.strokeText(text, 0, 0);
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

function canvasToPng(canvas: HTMLCanvasElement): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(async (blob) => {
      if (!blob) return reject(new Error("canvas.toBlob failed"));
      resolve(Buffer.from(await blob.arrayBuffer()));
    }, "image/png");
  });
}

/** 按像素宽度折行（ctx.font 需先设好）。 */
function wrapByWidth(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const words = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const tentative = cur ? cur + " " + w : w;
    if (cur && ctx.measureText(tentative).width > maxW) {
      lines.push(cur);
      cur = w;
    } else {
      cur = tentative;
    }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [text.trim()];
}

export interface CoverOpts {
  title: string;
  imagePath?: string;
  bg: [string, string];
  outPath: string;
}

/** 生成一张 9:16 封面：首图(加暗) + 大标题 + 黄色装饰条，嵌进笔记当封面用。 */
export async function renderCover(o: CoverOpts): Promise<void> {
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Cannot create a Canvas 2D context");

  // 背景：首图(铺满+加重暗化) 或 渐变
  const imgs = o.imagePath ? await loadImages([o.imagePath]) : [];
  if (imgs.length) {
    drawCover(ctx, imgs[0], 0.4);
    const sc = ctx.createLinearGradient(0, 0, 0, H);
    sc.addColorStop(0, "rgba(0,0,0,0.55)");
    sc.addColorStop(0.5, "rgba(0,0,0,0.32)");
    sc.addColorStop(1, "rgba(0,0,0,0.7)");
    ctx.fillStyle = sc;
    ctx.fillRect(0, 0, W, H);
  } else {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, o.bg[0]);
    g.addColorStop(1, o.bg[1]);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  // 标题：大字、自适应、上中位置
  const title = (o.title || "").trim() || "Untitled";
  const fontOf = (px: number) => `800 ${px}px ${FONT_STACK}`;
  let fs = 132;
  ctx.font = fontOf(fs);
  let lines = wrapByWidth(ctx, title, 900);
  while (lines.length > 4 && fs > 72) {
    fs -= 10;
    ctx.font = fontOf(fs);
    lines = wrapByWidth(ctx, title, 900);
  }
  const lineH = Math.round(fs * 1.16);
  const blockTop = Math.round(H * 0.4) - (lines.length * lineH) / 2;

  // 黄色装饰条
  ctx.fillStyle = "#ffd54a";
  ctx.fillRect(W / 2 - 90, blockTop - 56, 180, 12);

  ctx.save();
  ctx.font = fontOf(fs);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.lineWidth = Math.max(12, Math.round(fs * 0.14));
  ctx.strokeStyle = "rgba(0,0,0,0.92)";
  ctx.fillStyle = "#ffffff";
  ctx.shadowColor = "rgba(0,0,0,0.6)";
  ctx.shadowBlur = 18;
  ctx.shadowOffsetY = 6;
  lines.forEach((ln, i) => {
    const y = blockTop + i * lineH + lineH / 2;
    ctx.strokeText(ln, W / 2, y);
    ctx.fillText(ln, W / 2, y);
  });
  ctx.restore();

  writeFileSync(o.outPath, await canvasToPng(canvas));
}
