// M2：本地配音。两个后端：
//   - kokoro : 本地 sherpa-onnx + Kokoro int8 多语模型（高音质、中英双语、CPU 约实时）。
//              引擎/模型由 runtime.ts 首次自动下载，纯本地、无服务、无 Python。
//   - system : macOS `say`（零依赖回退）。
// 逐段合成 → 统一归一化到 24kHz/mono/s16 → 拿真实时长 → 段间插静音 → concat 成 narration.wav。

import { existsSync, writeFileSync } from "fs";
import { join } from "path";
import { probeDuration, runFfmpeg, runSay, runWithEnv, ToolPaths } from "../ffmpeg";
import type { KokoroRuntime } from "../runtime";
import type { ShortScript } from "../types";
import { t } from "../i18n";

export type TtsBackend = "system" | "kokoro";

export interface TtsConfig {
  backend: TtsBackend;
  /** say 音色（已按语言解析） */
  sayVoice: string;
  /** kokoro 就绪运行时（backend=kokoro 时由 assemble 传入） */
  runtime?: KokoroRuntime;
  /** kokoro 音色 id（已按语言解析） */
  sid: number;
}

export interface SegTiming {
  id: number;
  start: number;
  end: number;
}

export interface TtsResult {
  wavPath: string;
  timings: SegTiming[];
  totalSeconds: number;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function shellQuote(p: string): string {
  return `'${p.replace(/'/g, "'\\''")}'`;
}

async function synthSay(tools: ToolPaths, voice: string, text: string, raw: string): Promise<void> {
  const fmt = ["-o", raw, "--file-format=WAVE", "--data-format=LEI16@24000"];
  try {
    await runSay(tools, voice ? ["-v", voice, ...fmt, text] : [...fmt, text]);
  } catch {
    await runSay(tools, [...fmt, text]);
  }
}

async function synthKokoro(rt: KokoroRuntime, sid: number, text: string, raw: string): Promise<void> {
  const m = rt.modelDir;
  // 英文模型用 espeak-ng 直接 G2P；中文模型额外需要 jieba dict + 中英文 lexicon（rt 里带）。
  const args = [
    `--kokoro-model=${rt.modelFile}`,
    `--kokoro-voices=${join(m, "voices.bin")}`,
    `--kokoro-tokens=${join(m, "tokens.txt")}`,
    `--kokoro-data-dir=${join(m, "espeak-ng-data")}`,
  ];
  if (rt.dictDir) args.push(`--kokoro-dict-dir=${rt.dictDir}`);
  if (rt.lexicon) args.push(`--kokoro-lexicon=${rt.lexicon}`);
  args.push("--num-threads=2", `--sid=${sid}`, `--output-filename=${raw}`, text);
  const attempt = async (): Promise<boolean> => {
    try {
      await runWithEnv(rt.bin, args, { DYLD_LIBRARY_PATH: rt.libDir });
      return existsSync(raw);
    } catch {
      return false;
    }
  };
  // 偶发首调失败 → 重试一次。
  if (!(await attempt()) && !(await attempt())) {
    throw new Error("Kokoro synthesis failed (after retry)");
  }
}

export async function synthesize(
  tools: ToolPaths,
  tmpDir: string,
  script: ShortScript,
  cfg: TtsConfig,
  onStep?: (msg: string) => void,
  signal?: AbortSignal
): Promise<TtsResult> {
  const timings: SegTiming[] = [];
  const listLines: string[] = [];
  let cursor = 0;

  for (let i = 0; i < script.segments.length; i++) {
    if (signal?.aborted) throw new Error("Canceled");
    const seg = script.segments[i];
    onStep?.(t().voiceover(i + 1, script.segments.length));

    const raw = join(tmpDir, `raw_${i}.wav`);
    if (cfg.backend === "kokoro" && cfg.runtime) await synthKokoro(cfg.runtime, cfg.sid, seg.text, raw);
    else await synthSay(tools, cfg.sayVoice, seg.text, raw);

    // 归一化到 24kHz/mono/s16，保证不同后端都能 concat -c copy。
    const wav = join(tmpDir, `seg_${i}.wav`);
    await runFfmpeg(tools, ["-y", "-i", raw, "-ar", "24000", "-ac", "1", "-c:a", "pcm_s16le", wav]);

    const dur = await probeDuration(tools, wav);
    timings.push({ id: seg.id, start: round3(cursor), end: round3(cursor + dur) });
    cursor += dur;
    listLines.push(`file ${shellQuote(wav)}`);

    const pauseSec = Math.max(0, seg.pause_after_ms / 1000);
    if (pauseSec > 0) {
      const sil = join(tmpDir, `sil_${i}.wav`);
      await runFfmpeg(tools, ["-y", "-f", "lavfi", "-i", "anullsrc=r=24000:cl=mono", "-t", pauseSec.toFixed(3), "-c:a", "pcm_s16le", sil]);
      listLines.push(`file ${shellQuote(sil)}`);
      cursor += pauseSec;
    }
  }

  const listPath = join(tmpDir, "concat.txt");
  writeFileSync(listPath, listLines.join("\n"));
  const wavPath = join(tmpDir, "narration.wav");
  await runFfmpeg(tools, ["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", wavPath]);

  return { wavPath, timings, totalSeconds: round3(cursor) };
}
