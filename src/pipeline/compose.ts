// M3（合成）：背景(渐变/纯色) + 可选波形 + 定时字幕 PNG 叠加 → 1080x1920 mp4。
// 只用最基础的 ffmpeg 滤镜（color/gradients/showwaves/overlay + libx264/aac），不依赖 libass/drawtext。
// 这条滤镜链已在目标机器实测跑通。

import { join } from "path";
import { runFfmpeg, ToolPaths } from "../ffmpeg";

export interface CaptionClip {
  pngPath: string;
  start: number;
  end: number;
}

export interface BgPreset {
  id: string;
  name: string;
  kind: "gradient" | "solid";
  c0: string;
  c1?: string;
}

export const BACKGROUNDS: BgPreset[] = [
  { id: "midnight", name: "Midnight", kind: "gradient", c0: "0x0f2027", c1: "0x2c5364" },
  { id: "sunset", name: "Sunset", kind: "gradient", c0: "0x3a1c71", c1: "0xd76d77" },
  { id: "forest", name: "Forest", kind: "gradient", c0: "0x134e5e", c1: "0x71b280" },
  { id: "ink", name: "Ink", kind: "solid", c0: "0x101014" },
];

export interface ComposeOpts {
  tools: ToolPaths;
  tmpDir: string;
  wavPath: string;
  captions: CaptionClip[];
  totalSeconds: number;
  bg: BgPreset;
  withWaveform: boolean;
  captionY: number;
  onStderr?: (s: string) => void;
}

export async function compose(o: ComposeOpts): Promise<string> {
  const out = join(o.tmpDir, "out_9x16.mp4");
  const T = Math.max(1, o.totalSeconds).toFixed(3);

  const inputs: string[] = [];
  // 输入 0：背景
  if (o.bg.kind === "gradient") {
    inputs.push("-f", "lavfi", "-i", `gradients=s=1080x1920:c0=${o.bg.c0}:c1=${o.bg.c1 || o.bg.c0}:speed=0:duration=${T}`);
  } else {
    inputs.push("-f", "lavfi", "-i", `color=c=${o.bg.c0}:s=1080x1920:d=${T}`);
  }
  // 输入 1：音频
  inputs.push("-i", o.wavPath);
  // 输入 2..：字幕 PNG
  for (const c of o.captions) inputs.push("-i", c.pngPath);

  const fc: string[] = [];
  fc.push(`[0:v]trim=duration=${T},setsar=1,format=rgba[bg]`);
  let last = "bg";

  if (o.withWaveform) {
    fc.push(`[1:a]showwaves=s=1000x240:mode=cline:rate=30:colors=0x66ccff|0xffffff,format=rgba[wave]`);
    fc.push(`[${last}][wave]overlay=(W-w)/2:1560[bgw]`);
    last = "bgw";
  }

  o.captions.forEach((c, i) => {
    const inIdx = i + 2;
    const label = `cv${i}`;
    fc.push(
      `[${last}][${inIdx}:v]overlay=(W-w)/2:${o.captionY}:enable='between(t,${c.start.toFixed(3)},${c.end.toFixed(3)})'[${label}]`
    );
    last = label;
  });

  if (last === "bg") {
    // 既无波形也无字幕：补一个直通输出标签
    fc.push(`[bg]null[vout]`);
    last = "vout";
  }

  const args = [
    "-y",
    ...inputs,
    "-filter_complex",
    fc.join(";"),
    "-map",
    `[${last}]`,
    "-map",
    "1:a",
    "-r",
    "30",
    "-t",
    T,
    "-c:v",
    "libx264",
    "-profile:v",
    "high",
    "-pix_fmt",
    "yuv420p",
    "-crf",
    "19",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-movflags",
    "+faststart",
    out,
  ];

  await runFfmpeg(o.tools, args, o.onStderr);
  return out;
}
