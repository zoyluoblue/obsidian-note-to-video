import { App, PluginSettingTab, Setting } from "obsidian";
import type ZoyClipPlugin from "./main";
import type { Lang } from "./types";
import type { TtsBackend } from "./pipeline/tts";
import { BACKGROUNDS } from "./pipeline/compose";

export interface ZoyClipSettings {
  /** OpenAI 兼容端点。DeepSeek: https://api.deepseek.com */
  apiBaseUrl: string;
  model: string;
  apiKey: string;
  defaultLang: Lang;
  /** 目标时长上限（秒），超出触发一次压缩重写 */
  targetSeconds: number;
  /** ffmpeg 路径（留空用 PATH / 常见目录） */
  ffmpegPath: string;

  /** 配音后端：kokoro=本地高音质(首次自动下载引擎+模型) / system=macOS say */
  ttsBackend: TtsBackend;
  /** Kokoro 音色 id（--sid），中英各一 */
  kokoroSidEn: number;
  kokoroSidZh: number;
  /** 回退后端 macOS say 的中英音色 */
  voiceEn: string;
  voiceZh: string;

  /** 背景预设 id（见 compose.BACKGROUNDS） */
  background: string;
  /** 是否叠加音频波形 */
  withWaveform: boolean;
  /** 背景图片文件夹（可选，vault 相对或绝对路径）；笔记内嵌入的图会自动使用 */
  imagesFolder: string;
  /** Pexels API key；填了就按每段关键词自动配图（不填则用笔记/文件夹的图） */
  pexelsApiKey: string;
  /** 字幕风格：tiktok=少字大字弹出 / sentence=整句逐词高亮 */
  captionStyle: "tiktok" | "sentence";
  /** 背景音乐文件夹（可选）；随机取一首，说话时自动压低(ducking) */
  musicFolder: string;
  /** 背景音乐音量 0..1（ducking 前基准） */
  musicVolume: number;
  /** 是否额外生成一张小红书封面图 */
  makeCover: boolean;
}

export const DEFAULT_SETTINGS: ZoyClipSettings = {
  apiBaseUrl: "https://api.deepseek.com",
  model: "deepseek-chat",
  apiKey: "",
  defaultLang: "en",
  targetSeconds: 90,
  ffmpegPath: "",
  ttsBackend: "kokoro",
  kokoroSidEn: 0,
  kokoroSidZh: 50,
  voiceEn: "Samantha",
  voiceZh: "Tingting",
  background: "midnight",
  withWaveform: false,
  imagesFolder: "",
  pexelsApiKey: "",
  captionStyle: "sentence",
  musicFolder: "",
  musicVolume: 0.22,
  makeCover: true,
};

export class ZoyClipSettingTab extends PluginSettingTab {
  plugin: ZoyClipPlugin;

  constructor(app: App, plugin: ZoyClipPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  private text(
    container: HTMLElement,
    name: string,
    desc: string,
    get: () => string,
    set: (v: string) => void,
    placeholder = "",
    password = false
  ): void {
    new Setting(container)
      .setName(name)
      .setDesc(desc)
      .addText((t) => {
        t.setPlaceholder(placeholder)
          .setValue(get())
          .onChange(async (v) => {
            set(v.trim());
            await this.plugin.saveSettings();
          });
        if (password) t.inputEl.type = "password";
      });
  }

  display(): void {
    const { containerEl } = this;
    const s = this.plugin.settings;
    containerEl.empty();

    new Setting(containerEl).setName("脚本生成（云 LLM）").setHeading();
    this.text(containerEl, "API Base URL", "OpenAI 兼容端点。DeepSeek：https://api.deepseek.com；OpenAI：https://api.openai.com/v1",
      () => s.apiBaseUrl, (v) => (s.apiBaseUrl = v), "https://api.deepseek.com");
    this.text(containerEl, "模型", "如 deepseek-chat / gpt-4o-mini", () => s.model, (v) => (s.model = v), "deepseek-chat");
    this.text(containerEl, "API Key", "存于本机 data.json（明文）。首次发送会把笔记正文发往该云服务。",
      () => s.apiKey, (v) => (s.apiKey = v), "sk-...", true);
    this.text(containerEl, "目标时长上限（秒）", "超出会触发一次压缩重写", () => String(s.targetSeconds), (v) => {
      const n = parseInt(v, 10);
      s.targetSeconds = Number.isFinite(n) && n > 0 ? n : 90;
    }, "90");

    new Setting(containerEl).setName("配音").setHeading();
    new Setting(containerEl)
      .setName("配音后端")
      .setDesc("Kokoro：本地高音质英文配音，首次自动下载引擎+模型（约 130MB，仅一次），之后纯本地无服务。仅 Apple Silicon；其它情况自动回退 say。")
      .addDropdown((d) =>
        d
          .addOption("kokoro", "Kokoro 高音质（本地，自动下载）")
          .addOption("system", "系统 say（零依赖）")
          .setValue(s.ttsBackend)
          .onChange(async (v) => {
            s.ttsBackend = v as TtsBackend;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl).setName("Kokoro 音色").setHeading();
    this.text(containerEl, "英文音色 id（--sid）", "整数 0 起，每个数字一个音色（0 为默认美式女声）。改后重新出片即可试听挑选。", () => String(s.kokoroSidEn), (v) => {
      const n = parseInt(v, 10);
      s.kokoroSidEn = Number.isFinite(n) && n >= 0 ? n : 0;
    }, "0");

    new Setting(containerEl).setName("系统 say（回退后端）").setHeading();
    this.text(containerEl, "say 英文音色", "macOS say 音色名（可在系统设置下载高级音色）", () => s.voiceEn, (v) => (s.voiceEn = v), "Samantha");
    this.text(containerEl, "say 中文音色", "如 Tingting", () => s.voiceZh, (v) => (s.voiceZh = v), "Tingting");

    new Setting(containerEl).setName("出片（逐帧渲染）").setHeading();
    new Setting(containerEl)
      .setName("字幕风格")
      .setDesc("TikTok：少字大字、逐块弹出；整句：整句显示、逐词高亮")
      .addDropdown((d) =>
        d
          .addOption("tiktok", "TikTok 风（少字大字弹出）")
          .addOption("sentence", "整句逐词高亮")
          .setValue(s.captionStyle)
          .onChange(async (v) => {
            s.captionStyle = v as "tiktok" | "sentence";
            await this.plugin.saveSettings();
          })
      );
    new Setting(containerEl).setName("背景预设").addDropdown((d) => {
      for (const b of BACKGROUNDS) d.addOption(b.id, b.name);
      d.setValue(s.background).onChange(async (v) => {
        s.background = v;
        await this.plugin.saveSettings();
      });
    });
    new Setting(containerEl).setName("叠加音频波形").addToggle((t) =>
      t.setValue(s.withWaveform).onChange(async (v) => {
        s.withWaveform = v;
        await this.plugin.saveSettings();
      })
    );
    this.text(containerEl, "Pexels API Key（自动配图）", "填了就按每段关键词自动从 Pexels 免费图库配图（去 pexels.com/api 免费申请）。留空则用下面手动的图。",
      () => s.pexelsApiKey, (v) => (s.pexelsApiKey = v), "Pexels key", true);
    this.text(containerEl, "图片文件夹（手动，可选）", "没填 Pexels key 时用：放一组图当背景/B-roll（按段落切换 + Ken Burns + 交叉淡化）。也可在笔记里 ![[图]] 嵌入。都没有则用渐变背景。",
      () => s.imagesFolder, (v) => (s.imagesFolder = v), "vault 相对路径 或 绝对路径");
    this.text(containerEl, "背景音乐文件夹（可选）", "放一组音乐(mp3/wav...)，每条视频随机取一首；说话时自动压低(ducking)。留空则无背景乐。",
      () => s.musicFolder, (v) => (s.musicFolder = v), "vault 相对路径 或 绝对路径");
    this.text(containerEl, "背景音乐音量", "0–1，默认 0.22（说话时还会再自动压低）", () => String(s.musicVolume), (v) => {
      const n = parseFloat(v);
      s.musicVolume = Number.isFinite(n) && n >= 0 && n <= 1 ? n : 0.22;
    }, "0.22");
    new Setting(containerEl)
      .setName("生成小红书封面图")
      .setDesc("额外出一张 9:16 封面（首图 + 大标题），嵌进笔记，发小红书当封面用")
      .addToggle((t) =>
        t.setValue(s.makeCover).onChange(async (v) => {
          s.makeCover = v;
          await this.plugin.saveSettings();
        })
      );
    this.text(containerEl, "ffmpeg 路径", "留空则自动在 PATH 与 /opt/homebrew/bin 等查找。macOS：brew install ffmpeg",
      () => s.ffmpegPath, (v) => (s.ffmpegPath = v), "/opt/homebrew/bin/ffmpeg");
  }
}
