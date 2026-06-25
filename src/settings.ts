import { App, PluginSettingTab, Setting } from "obsidian";
import type ZoyClipPlugin from "./main";
import { t, resolveLang, setUiLang, type LangSetting } from "./i18n";

/** LLM 服务商预设：切换即自动填好 Base URL 与默认模型（仍可手改）。 */
export const PROVIDERS = {
  openai: { label: "OpenAI", baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" },
  deepseek: { label: "DeepSeek", baseUrl: "https://api.deepseek.com", model: "deepseek-chat" },
} as const;
export type Provider = keyof typeof PROVIDERS;

/** 取当前服务商对应的 API Key（两家分开存，切换不丢）。 */
export function activeApiKey(s: ZoyClipSettings): string {
  return s.provider === "deepseek" ? s.apiKeyDeepseek : s.apiKeyOpenai;
}

export interface ZoyClipSettings {
  /** 界面 + 输出语言：auto（跟随 Obsidian，默认）/ en / zh */
  language: LangSetting;
  /** LLM 服务商：openai（默认）/ deepseek */
  provider: Provider;
  /** OpenAI 兼容端点（按服务商自动填，可手改） */
  apiBaseUrl: string;
  model: string;
  /** 两家服务商的 API Key 分开存，切换不丢 */
  apiKeyOpenai: string;
  apiKeyDeepseek: string;
  /** 目标时长上限（秒），超出触发一次压缩重写 */
  targetSeconds: number;
  /** 出片前弹窗预览/编辑脚本 */
  previewBeforeRender: boolean;
  /** Kokoro 英文音色 id（en-v0_19 模型的 --sid） */
  kokoroSidEn: number;
  /** Kokoro 中文音色 id（multi-lang 模型的 --sid，46/50/53 为中文音色） */
  kokoroSidZh: number;
  /** 字幕风格：tiktok=少字大字 / sentence=整句 */
  captionStyle: "tiktok" | "sentence";
  /** Pexels API key；填了就按每段关键词自动配图 */
  pexelsApiKey: string;
  /** 图片文件夹（手动，可选） */
  imagesFolder: string;
  /** 背景音乐文件夹（可选） */
  musicFolder: string;
  /** 背景音乐音量 0..1 */
  musicVolume: number;
  /** 是否额外生成一张封面图 */
  makeCover: boolean;
  /** ffmpeg 路径（留空自动查找 / 首次自动下载） */
  ffmpegPath: string;
}

export const DEFAULT_SETTINGS: ZoyClipSettings = {
  language: "auto",
  provider: "openai",
  apiBaseUrl: PROVIDERS.openai.baseUrl,
  model: PROVIDERS.openai.model,
  apiKeyOpenai: "",
  apiKeyDeepseek: "",
  targetSeconds: 90,
  previewBeforeRender: true,
  kokoroSidEn: 0,
  kokoroSidZh: 46,
  captionStyle: "sentence",
  pexelsApiKey: "",
  imagesFolder: "",
  musicFolder: "",
  musicVolume: 0.22,
  makeCover: true,
  ffmpegPath: "",
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
      .addText((t2) => {
        t2.setPlaceholder(placeholder)
          .setValue(get())
          .onChange(async (v) => {
            set(v.trim());
            await this.plugin.saveSettings();
          });
        if (password) t2.inputEl.type = "password";
      });
  }

  display(): void {
    const { containerEl } = this;
    const s = this.plugin.settings;
    const L = t();
    const outLang = resolveLang(s.language); // 当前输出/界面语言，用于音色字段
    containerEl.empty();

    // 语言切换（最上面，控制整个界面 + 输出视频语言）
    new Setting(containerEl)
      .setName(L.langName)
      .setDesc(L.langDesc)
      .addDropdown((d) =>
        d
          .addOption("auto", L.langAuto)
          .addOption("en", L.langEn)
          .addOption("zh", L.langZh)
          .setValue(s.language)
          .onChange(async (v) => {
            s.language = v as LangSetting;
            setUiLang(resolveLang(s.language));
            await this.plugin.saveSettings();
            this.display(); // 立即按新语言重绘设置面板
          })
      );

    const intro = containerEl.createDiv({ cls: "setting-item-description zoyclip-intro" });
    intro.setText(L.intro);

    new Setting(containerEl).setName(L.hScript).setHeading();
    new Setting(containerEl)
      .setName(L.provName)
      .setDesc(L.provDesc)
      .addDropdown((d) => {
        for (const id of Object.keys(PROVIDERS) as Provider[]) d.addOption(id, PROVIDERS[id].label);
        d.setValue(s.provider).onChange(async (v) => {
          s.provider = v as Provider;
          s.apiBaseUrl = PROVIDERS[s.provider].baseUrl;
          s.model = PROVIDERS[s.provider].model;
          await this.plugin.saveSettings();
          this.display();
        });
      });
    this.text(containerEl, L.baseName, L.baseDesc, () => s.apiBaseUrl, (v) => (s.apiBaseUrl = v), PROVIDERS[s.provider].baseUrl);
    this.text(containerEl, L.modelName, L.modelDesc, () => s.model, (v) => (s.model = v), PROVIDERS[s.provider].model);
    const pLabel = PROVIDERS[s.provider].label;
    this.text(containerEl, L.keyName(pLabel), L.keyDesc(pLabel),
      () => activeApiKey(s),
      (v) => {
        if (s.provider === "deepseek") s.apiKeyDeepseek = v;
        else s.apiKeyOpenai = v;
      },
      "sk-...", true);
    this.text(containerEl, L.maxName, L.maxDesc, () => String(s.targetSeconds), (v) => {
      const n = parseInt(v, 10);
      s.targetSeconds = Number.isFinite(n) && n > 0 ? n : 90;
    }, "90");
    new Setting(containerEl)
      .setName(L.prevName)
      .setDesc(L.prevDesc)
      .addToggle((tg) =>
        tg.setValue(s.previewBeforeRender).onChange(async (v) => {
          s.previewBeforeRender = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl).setName(L.hVoice).setHeading();
    this.text(containerEl, L.voiceIdName, L.voiceIdDesc,
      () => String(outLang === "zh" ? s.kokoroSidZh : s.kokoroSidEn),
      (v) => {
        const n = parseInt(v, 10);
        const val = Number.isFinite(n) && n >= 0 ? n : 0;
        if (outLang === "zh") s.kokoroSidZh = val;
        else s.kokoroSidEn = val;
      }, "0");

    new Setting(containerEl).setName(L.hOutput).setHeading();
    new Setting(containerEl)
      .setName(L.capName)
      .setDesc(L.capDesc)
      .addDropdown((d) =>
        d
          .addOption("tiktok", L.capTikTok)
          .addOption("sentence", L.capSentence)
          .setValue(s.captionStyle)
          .onChange(async (v) => {
            s.captionStyle = v as "tiktok" | "sentence";
            await this.plugin.saveSettings();
          })
      );
    this.text(containerEl, L.pexName, L.pexDesc, () => s.pexelsApiKey, (v) => (s.pexelsApiKey = v), L.phPexels, true);
    this.text(containerEl, L.imgName, L.imgDesc, () => s.imagesFolder, (v) => (s.imagesFolder = v), L.phPath);
    this.text(containerEl, L.musName, L.musDesc, () => s.musicFolder, (v) => (s.musicFolder = v), L.phPath);
    this.text(containerEl, L.musVolName, L.musVolDesc, () => String(s.musicVolume), (v) => {
      const n = parseFloat(v);
      s.musicVolume = Number.isFinite(n) && n >= 0 && n <= 1 ? n : 0.22;
    }, "0.22");
    new Setting(containerEl)
      .setName(L.coverName)
      .setDesc(L.coverDesc)
      .addToggle((tg) =>
        tg.setValue(s.makeCover).onChange(async (v) => {
          s.makeCover = v;
          await this.plugin.saveSettings();
        })
      );
    this.text(containerEl, L.ffName, L.ffDesc, () => s.ffmpegPath, (v) => (s.ffmpegPath = v), "/opt/homebrew/bin/ffmpeg");
  }
}
