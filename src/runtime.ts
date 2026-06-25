// 本地 Kokoro 运行时：首次自动下载 sherpa-onnx 二进制 + Kokoro 模型到插件目录，之后纯本地。
// 双语：英文用 en-v0_19（int8 ~147MB，音质好、体积小）；中文用 multi-lang-v1_1（~348MB，含 jieba dict + lexicon）。
// 引擎共用，模型按输出语言各自按需下载。仅 macOS Apple Silicon。

import { chmodSync, createWriteStream, existsSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { spawn } from "child_process";
import { get as httpsGet } from "https";
import { t } from "./i18n";

export type KokoroLang = "en" | "zh";

export interface KokoroRuntime {
  bin: string;
  libDir: string;
  modelDir: string;
  /** 模型权重文件绝对路径（en 为 model.int8.onnx，zh 为 model.onnx） */
  modelFile: string;
  lang: KokoroLang;
  /** 中文模型需要：逗号分隔的 lexicon 路径（含中英文 lexicon） */
  lexicon?: string;
  /** 中文模型需要：jieba dict 目录 */
  dictDir?: string;
}

const SHERPA_VER = "1.13.3";
const SHERPA_DIR = `sherpa-onnx-v${SHERPA_VER}-osx-arm64-shared`;
const SHERPA_URL = `https://github.com/k2-fsa/sherpa-onnx/releases/download/v${SHERPA_VER}/${SHERPA_DIR}.tar.bz2`;

// 每种输出语言一个 Kokoro 模型规格（目录名 + 权重文件 + 是否需要中文 lexicon/dict）。
interface ModelSpec {
  name: string;
  file: string;
  zh: boolean;
}
const MODEL_EN: ModelSpec = { name: "kokoro-int8-en-v0_19", file: "model.int8.onnx", zh: false };
const MODEL_ZH: ModelSpec = { name: "kokoro-multi-lang-v1_1", file: "model.onnx", zh: true };
const modelUrl = (name: string): string =>
  `https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/${name}.tar.bz2`;

export function kokoroSupported(): boolean {
  return process.platform === "darwin" && process.arch === "arm64";
}

function downloadOnce(url: string, dest: string, onProgress?: (frac: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = createWriteStream(dest);
    let settled = false;
    const fail = (e: Error) => {
      if (settled) return;
      settled = true;
      try {
        file.destroy();
      } catch {
        /* ignore */
      }
      try {
        rmSync(dest, { force: true });
      } catch {
        /* ignore */
      }
      reject(e);
    };
    const go = (u: string, redirects: number) => {
      const req = httpsGet(u, (res) => {
        const code = res.statusCode || 0;
        if ([301, 302, 303, 307, 308].includes(code) && res.headers.location) {
          if (redirects > 6) return fail(new Error("Too many redirects"));
          res.resume();
          return go(res.headers.location, redirects + 1);
        }
        if (code !== 200) {
          res.resume();
          return fail(new Error(`Download failed: HTTP ${code}`));
        }
        const total = parseInt(res.headers["content-length"] || "0", 10);
        let got = 0;
        res.on("data", (c: Buffer) => {
          got += c.length;
          if (total && onProgress) onProgress(got / total);
        });
        res.on("error", fail); // 关键：response 流的读错误(ETIMEDOUT/ECONNRESET)也要捕获，否则未捕获异常崩溃
        res.pipe(file);
        file.on("error", fail);
        file.on("finish", () => {
          if (settled) return;
          settled = true;
          file.close((err) => (err ? reject(err) : resolve()));
        });
      });
      req.on("error", fail);
      req.setTimeout(60000, () => req.destroy(new Error("Download timed out (no response)")));
    };
    go(url, 0);
  });
}

/** 带重试的下载：网络抖动时重试，最多 3 次。 */
async function download(url: string, dest: string, onProgress?: (frac: number) => void): Promise<void> {
  let lastErr: Error | undefined;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await downloadOnce(url, dest, onProgress);
      return;
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
    }
  }
  throw new Error(`Download failed (after 3 retries): ${lastErr?.message ?? ""}`);
}

function spawnOk(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args);
    let err = "";
    child.stderr.on("data", (d: Buffer) => (err += d.toString()));
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} failed: ${err.slice(-200)}`))));
  });
}

function clearQuarantine(dir: string): Promise<void> {
  // 下载来的文件一般无 quarantine；保险起见清一下，失败忽略。
  return new Promise((resolve) => {
    const child = spawn("xattr", ["-dr", "com.apple.quarantine", dir]);
    child.on("error", () => resolve());
    child.on("close", () => resolve());
  });
}

/** 确保引擎 + 对应语言的模型就绪（缺则下载解压），返回可执行与模型路径。 */
export async function ensureKokoroRuntime(
  runtimeDir: string,
  lang: KokoroLang,
  onStep: (msg: string) => void
): Promise<KokoroRuntime> {
  if (!kokoroSupported()) {
    throw new Error(t().kokoroAppleOnly);
  }
  mkdirSync(runtimeDir, { recursive: true });
  const bin = join(runtimeDir, SHERPA_DIR, "bin", "sherpa-onnx-offline-tts");
  const libDir = join(runtimeDir, SHERPA_DIR, "lib");

  if (!existsSync(bin)) {
    onStep(t().dlEngineFirst);
    const tb = join(runtimeDir, "sherpa.tar.bz2");
    await download(SHERPA_URL, tb, (f) => onStep(t().dlEnginePct(Math.round(f * 100))));
    onStep(t().extractingEngine);
    await spawnOk("tar", ["xf", tb, "-C", runtimeDir]);
    rmSync(tb, { force: true }); // 解压后删压缩包，省空间
    await clearQuarantine(join(runtimeDir, SHERPA_DIR));
  }

  const spec = lang === "zh" ? MODEL_ZH : MODEL_EN;
  const modelDir = join(runtimeDir, spec.name);
  const modelFile = join(modelDir, spec.file);

  if (!existsSync(modelFile)) {
    onStep(t().dlModelFirst);
    const tb = join(runtimeDir, `model-${lang}.tar.bz2`);
    await download(modelUrl(spec.name), tb, (f) => onStep(t().dlModelPct(Math.round(f * 100))));
    onStep(t().extractingModel);
    await spawnOk("tar", ["xf", tb, "-C", runtimeDir]);
    rmSync(tb, { force: true }); // 解压后删压缩包，省空间
  }

  if (!existsSync(bin)) throw new Error(t().voiceEngineFailed);
  if (!existsSync(modelFile)) throw new Error(t().kokoroModelFailed);

  const rt: KokoroRuntime = { bin, libDir, modelDir, modelFile, lang };
  if (spec.zh) {
    // 中文需要 jieba 分词 dict + 中英文 lexicon（实测：三个 lexicon 都要传）。
    rt.dictDir = join(modelDir, "dict");
    rt.lexicon = ["lexicon-gb-en.txt", "lexicon-us-en.txt", "lexicon-zh.txt"].map((f) => join(modelDir, f)).join(",");
  }
  return rt;
}

// ── ffmpeg 自动下载（静态二进制，macOS x64/arm64）────────────────────────
const FFSTATIC_VER = "b6.1.1";

function ffStaticUrl(name: "ffmpeg" | "ffprobe"): string {
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  return `https://github.com/eugeneware/ffmpeg-static/releases/download/${FFSTATIC_VER}/${name}-darwin-${arch}`;
}

export function ffmpegAutoSupported(): boolean {
  return process.platform === "darwin";
}

/** 系统无可用 ffmpeg 时，自动下载静态 ffmpeg/ffprobe 到插件目录（含全部所需编码器/滤镜，已实测）。 */
export async function ensureFfmpeg(
  runtimeDir: string,
  onStep: (m: string) => void
): Promise<{ ffmpeg: string; ffprobe: string }> {
  if (!ffmpegAutoSupported()) {
    throw new Error(t().ffmpegAutoMacOnly);
  }
  mkdirSync(runtimeDir, { recursive: true });
  const ffmpeg = join(runtimeDir, "ffmpeg");
  const ffprobe = join(runtimeDir, "ffprobe");

  if (!existsSync(ffmpeg)) {
    onStep(t().dlFfmpegFirst);
    await download(ffStaticUrl("ffmpeg"), ffmpeg, (f) => onStep(t().dlFfmpegPct(Math.round(f * 100))));
    chmodSync(ffmpeg, 0o755);
  }
  if (!existsSync(ffprobe)) {
    onStep(t().dlFfprobeFirst);
    await download(ffStaticUrl("ffprobe"), ffprobe, (f) => onStep(t().dlFfprobePct(Math.round(f * 100))));
    chmodSync(ffprobe, 0o755);
  }
  await clearQuarantine(ffmpeg);
  await clearQuarantine(ffprobe);
  return { ffmpeg, ffprobe };
}
