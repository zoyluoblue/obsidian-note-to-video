// 本地 Kokoro 运行时：首次自动下载 sherpa-onnx 二进制 + Kokoro 多语模型到插件目录，之后纯本地。
// 引擎 ~26MB + 模型 ~147MB（int8 中英双语），一次性下载并缓存。仅 macOS Apple Silicon。

import { createWriteStream, existsSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { spawn } from "child_process";
import { get as httpsGet } from "https";

export interface KokoroRuntime {
  bin: string;
  libDir: string;
  modelDir: string;
}

const SHERPA_VER = "1.13.3";
const SHERPA_DIR = `sherpa-onnx-v${SHERPA_VER}-osx-arm64-shared`;
const SHERPA_URL = `https://github.com/k2-fsa/sherpa-onnx/releases/download/v${SHERPA_VER}/${SHERPA_DIR}.tar.bz2`;
// 专用英文模型（Kokoro v0.19，int8 ~103MB，60+ 英文音色）。中文暂不支持。
const MODEL_NAME = "kokoro-int8-en-v0_19";
const MODEL_URL = `https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/${MODEL_NAME}.tar.bz2`;

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
          if (redirects > 6) return fail(new Error("重定向过多"));
          res.resume();
          return go(res.headers.location, redirects + 1);
        }
        if (code !== 200) {
          res.resume();
          return fail(new Error(`下载失败 HTTP ${code}`));
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
      req.setTimeout(60000, () => req.destroy(new Error("下载超时（网络长时间无响应）")));
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
  throw new Error(`下载失败（已重试 3 次）：${lastErr?.message ?? ""}`);
}

function spawnOk(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args);
    let err = "";
    child.stderr.on("data", (d: Buffer) => (err += d.toString()));
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} 失败：${err.slice(-200)}`))));
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

/** 确保引擎+模型就绪（缺则下载解压），返回可执行与模型路径。 */
export async function ensureKokoroRuntime(runtimeDir: string, onStep: (msg: string) => void): Promise<KokoroRuntime> {
  if (!kokoroSupported()) {
    throw new Error("本地 Kokoro 引擎目前仅支持 Apple Silicon（macOS arm64）。请在设置里改用「系统 say」后端。");
  }
  mkdirSync(runtimeDir, { recursive: true });
  const bin = join(runtimeDir, SHERPA_DIR, "bin", "sherpa-onnx-offline-tts");
  const libDir = join(runtimeDir, SHERPA_DIR, "lib");
  const modelDir = join(runtimeDir, MODEL_NAME);

  if (!existsSync(bin)) {
    onStep("首次准备：下载本地语音引擎（约 26MB，仅此一次）…");
    const tb = join(runtimeDir, "sherpa.tar.bz2");
    await download(SHERPA_URL, tb, (f) => onStep(`下载引擎 ${(f * 100).toFixed(0)}%…`));
    onStep("解压引擎…");
    await spawnOk("tar", ["xf", tb, "-C", runtimeDir]);
    rmSync(tb, { force: true }); // 解压后删压缩包，省空间
    await clearQuarantine(join(runtimeDir, SHERPA_DIR));
  }

  if (!existsSync(join(modelDir, "model.int8.onnx"))) {
    onStep("首次准备：下载 Kokoro 音色模型（约 147MB，仅此一次）…");
    const tb = join(runtimeDir, "model.tar.bz2");
    await download(MODEL_URL, tb, (f) => onStep(`下载模型 ${(f * 100).toFixed(0)}%…`));
    onStep("解压模型…");
    await spawnOk("tar", ["xf", tb, "-C", runtimeDir]);
    rmSync(tb, { force: true }); // 解压后删压缩包，省空间
  }

  if (!existsSync(bin)) throw new Error("语音引擎准备失败（找不到可执行文件）");
  if (!existsSync(join(modelDir, "model.int8.onnx"))) throw new Error("Kokoro 模型准备失败");
  return { bin, libDir, modelDir };
}
