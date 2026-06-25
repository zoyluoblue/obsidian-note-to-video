// 外部进程封装：ffmpeg / ffprobe / say。仅桌面可用。
// GUI 应用的 PATH 常缺 /opt/homebrew/bin，故 spawn 时显式补常见 bin 目录。

import { spawn } from "child_process";
import { existsSync } from "fs";

const EXTRA_PATHS = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"];

export interface ToolPaths {
  ffmpeg: string;
  ffprobe: string;
  say: string;
}

function env(): NodeJS.ProcessEnv {
  return { ...process.env, PATH: EXTRA_PATHS.join(":") + ":" + (process.env.PATH || "") };
}

function locate(bin: string, userPath: string): string {
  if (userPath && existsSync(userPath)) return userPath;
  for (const d of EXTRA_PATHS) {
    const p = `${d}/${bin}`;
    if (existsSync(p)) return p;
  }
  return bin; // 交给 PATH
}

export function resolveTools(ffmpegPathSetting: string): ToolPaths {
  const ffmpeg = locate("ffmpeg", ffmpegPathSetting);
  const ffprobe =
    ffmpegPathSetting && existsSync(ffmpegPathSetting)
      ? ffmpegPathSetting.replace(/ffmpeg$/, "ffprobe")
      : locate("ffprobe", "");
  return { ffmpeg, ffprobe, say: locate("say", "") };
}

function spawnP(cmd: string, args: string[], onStderr?: (s: string) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { env: env() });
    let err = "";
    child.stderr.on("data", (d: Buffer) => {
      const s = d.toString();
      err += s;
      onStderr?.(s);
    });
    child.on("error", (e) => reject(new Error(`无法运行 ${cmd}：${e.message}`)));
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} 退出码 ${code}：${err.slice(-400)}`))
    );
  });
}

export function runFfmpeg(tools: ToolPaths, args: string[], onStderr?: (s: string) => void): Promise<void> {
  return spawnP(tools.ffmpeg, args, onStderr);
}

export function runSay(tools: ToolPaths, args: string[]): Promise<void> {
  return spawnP(tools.say, args);
}

/** 运行任意可执行，并注入额外环境变量（如 sherpa-onnx 需要的 DYLD_LIBRARY_PATH）。 */
export function runWithEnv(cmd: string, args: string[], extraEnv: Record<string, string>): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { env: { ...env(), ...extraEnv } });
    let err = "";
    child.stderr.on("data", (d: Buffer) => (err += d.toString()));
    child.on("error", (e) => reject(new Error(`无法运行 ${cmd}：${e.message}`)));
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} 退出码 ${code}：${err.slice(-300)}`))));
  });
}

export function probeDuration(tools: ToolPaths, file: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      tools.ffprobe,
      ["-hide_banner", "-loglevel", "error", "-show_entries", "format=duration", "-of", "default=nokey=1:noprint_wrappers=1", file],
      { env: env() }
    );
    let out = "";
    let err = "";
    child.stdout.on("data", (d: Buffer) => (out += d.toString()));
    child.stderr.on("data", (d: Buffer) => (err += d.toString()));
    child.on("error", reject);
    child.on("close", (code) => {
      const v = parseFloat(out.trim());
      if (code === 0 && Number.isFinite(v)) resolve(v);
      else reject(new Error(`ffprobe 失败：${err.slice(-200)}`));
    });
  });
}

/** 校验 ffmpeg 可运行且有 libx264；不可用则抛带指引的错误。 */
export function checkFfmpeg(tools: ToolPaths): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(tools.ffmpeg, ["-hide_banner", "-encoders"], { env: env() });
    let out = "";
    child.stdout.on("data", (d: Buffer) => (out += d.toString()));
    child.on("error", () =>
      reject(new Error("找不到 ffmpeg。请在设置里填 ffmpeg 路径，或 macOS 执行 brew install ffmpeg"))
    );
    child.on("close", () =>
      out.includes("libx264") ? resolve() : reject(new Error("ffmpeg 缺少 libx264 编码器，请安装完整版 ffmpeg"))
    );
  });
}
