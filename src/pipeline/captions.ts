// M3（字幕卡）：用 Electron 渲染层的 Canvas 2D 把每段字幕渲成透明 PNG（大字 + 粗描边 + 阴影），
// 交给 ffmpeg overlay 叠加。不依赖 libass/drawtext，字体/换行/emoji 全由系统字体处理。

import { writeFileSync } from "fs";
import { join } from "path";
import type { Lang, ShortScript } from "../types";
import type { SegTiming } from "./tts";
import type { CaptionClip } from "./compose";

export interface CaptionStyle {
  fontSize: number;
  maxWidth: number;
  lang: Lang;
}

function fontFamily(lang: Lang): string {
  return lang === "zh"
    ? '"PingFang SC","Hiragino Sans GB","Heiti SC",sans-serif'
    : '"Helvetica Neue","Arial",sans-serif';
}

function canvasToPng(canvas: HTMLCanvasElement): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(async (blob) => {
      if (!blob) return reject(new Error("canvas.toBlob failed"));
      resolve(Buffer.from(await blob.arrayBuffer()));
    }, "image/png");
  });
}

export async function renderCaptions(
  tmpDir: string,
  script: ShortScript,
  timings: SegTiming[],
  style: CaptionStyle
): Promise<CaptionClip[]> {
  const clips: CaptionClip[] = [];
  const fz = style.fontSize;
  const lineH = Math.round(fz * 1.3);
  const padX = 48;
  const padY = 36;
  const font = `700 ${fz}px ${fontFamily(style.lang)}`;

  for (let i = 0; i < script.segments.length; i++) {
    const seg = script.segments[i];
    const t = timings[i];
    const lines = seg.subtitle_lines.length ? seg.subtitle_lines : [seg.text];

    const canvas = document.createElement("canvas");
    let ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Cannot create a Canvas 2D context");
    ctx.font = font;

    let textW = 0;
    for (const ln of lines) textW = Math.max(textW, ctx.measureText(ln).width);

    canvas.width = Math.max(2, Math.min(style.maxWidth, Math.ceil(textW)) + padX * 2);
    canvas.height = Math.max(2, lines.length * lineH + padY * 2);

    // 改尺寸会重置上下文，重新取一次并配置
    ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Cannot create a Canvas 2D context");
    ctx.font = font;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.miterLimit = 2;
    ctx.lineWidth = Math.max(8, Math.round(fz * 0.18));
    ctx.strokeStyle = "rgba(0,0,0,0.92)";
    ctx.fillStyle = "#ffffff";
    ctx.shadowColor = "rgba(0,0,0,0.45)";
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 3;

    lines.forEach((ln, li) => {
      const y = padY + lineH * li + lineH / 2;
      ctx!.strokeText(ln, canvas.width / 2, y);
      ctx!.fillText(ln, canvas.width / 2, y);
    });

    const png = join(tmpDir, `cap_${i}.png`);
    writeFileSync(png, await canvasToPng(canvas));
    clips.push({ pngPath: png, start: t.start, end: t.end });
  }

  return clips;
}
