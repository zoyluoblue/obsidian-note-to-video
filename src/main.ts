import { App, MarkdownView, Menu, Modal, Notice, Plugin, TAbstractFile, TFile } from "obsidian";
import { activeApiKey, DEFAULT_SETTINGS, ZoyClipSettings, ZoyClipSettingTab } from "./settings";
import { resolveLang, setUiLang, t } from "./i18n";
import { generateScript } from "./pipeline/script";
import { produceVideo } from "./pipeline/assemble";
import type { ShortScript } from "./types";

export default class ZoyClipPlugin extends Plugin {
  settings: ZoyClipSettings = DEFAULT_SETTINGS;
  /** 当前出片任务的取消控制器（点进度提示 / 命令面板可取消） */
  currentAbort?: AbortController;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.addSettingTab(new ZoyClipSettingTab(this.app, this));

    this.addRibbonIcon("clapperboard", t().ribbonTooltip, () => {
      void this.withActiveFile((f) => produceVideo(this, f));
    });

    this.addCommand({
      id: "produce-video",
      name: t().cmdProduce,
      checkCallback: (checking) => this.activeFileCallback(checking, (f) => produceVideo(this, f)),
    });

    this.addCommand({
      id: "cancel-produce",
      name: t().cmdCancel,
      checkCallback: (checking) => {
        if (!this.currentAbort) return false;
        if (!checking) this.currentAbort.abort();
        return true;
      },
    });

    this.addCommand({
      id: "generate-script",
      name: t().cmdGenScript,
      checkCallback: (checking) =>
        this.activeFileCallback(checking, (f) => this.previewScript(f)),
    });

    this.registerEvent(
      this.app.workspace.on("file-menu", (menu: Menu, file: TAbstractFile) => {
        if (file instanceof TFile && file.extension === "md") {
          menu.addItem((item) =>
            item
              .setTitle(t().menuMakeVideo)
              .setIcon("clapperboard")
              .onClick(() => void produceVideo(this, file))
          );
        }
      })
    );
  }

  /** 取当前 Markdown 笔记并执行操作；无则提示。 */
  private async withActiveFile(fn: (file: TFile) => Promise<void>): Promise<void> {
    const file = this.app.workspace.getActiveViewOfType(MarkdownView)?.file;
    if (!file) {
      new Notice(t().openNoteFirst);
      return;
    }
    await fn(file);
  }

  private activeFileCallback(checking: boolean, fn: (file: TFile) => Promise<void>): boolean {
    const file = this.app.workspace.getActiveViewOfType(MarkdownView)?.file;
    if (!file) return false;
    if (!checking) void fn(file);
    return true;
  }

  private async previewScript(file: TFile): Promise<void> {
    if (!activeApiKey(this.settings)) {
      new Notice(t().setKeyFirst(this.settings.provider === "deepseek" ? "DeepSeek" : "OpenAI"));
      return;
    }
    const lang = resolveLang(this.settings.language);
    setUiLang(lang);
    const notice = new Notice(t().genScript, 0);
    try {
      const raw = await this.app.vault.cachedRead(file);
      const script = await generateScript(this.settings, raw, lang);
      notice.hide();
      new Notice(t().scriptReady(script.segments.length, Math.round(script.total_est_seconds)));
      new ScriptModal(this.app, script).open();
    } catch (e) {
      notice.hide();
      new Notice(t().failed(e instanceof Error ? e.message : String(e)));
      console.error("[ZoyClip]", e);
    }
  }

  async loadSettings(): Promise<void> {
    const loaded = ((await this.loadData()) ?? {}) as Partial<ZoyClipSettings> & { apiKey?: string };
    const s = Object.assign({}, DEFAULT_SETTINGS, loaded) as ZoyClipSettings;
    if (loaded.provider === undefined) {
      // 旧版迁移：旧设置只有单个 apiKey + apiBaseUrl。按旧 Base URL 推断服务商，
      // 并把旧 key 归到对应服务商，保住老用户已配置的可用状态。
      const isDeepseek = /deepseek/i.test(loaded.apiBaseUrl ?? "");
      s.provider = isDeepseek ? "deepseek" : "openai";
      if (loaded.apiKey) {
        if (isDeepseek && !s.apiKeyDeepseek) s.apiKeyDeepseek = loaded.apiKey;
        else if (!isDeepseek && !s.apiKeyOpenai) s.apiKeyOpenai = loaded.apiKey;
      }
    }
    // 清掉本版已移除的旧字段，避免 data.json 残留死键
    // 清掉本版已移除的旧字段，避免 data.json 残留死键。
    // 注意：language / kokoroSidZh 是现役字段，故意不在此列表里（别误加）。
    const bag = s as unknown as Record<string, unknown>;
    for (const k of ["apiKey", "ttsBackend", "background", "withWaveform", "voiceEn", "voiceZh", "defaultLang"]) {
      delete bag[k];
    }
    this.settings = s;
    setUiLang(resolveLang(this.settings.language)); // 按设置语言初始化 UI 文案
    await this.saveSettings(); // 归一化落库（写入 provider + 分离的 key，移除旧字段）
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}

/** 「仅生成脚本」时的预览 Modal。 */
class ScriptModal extends Modal {
  private script: ShortScript;

  constructor(app: App, script: ShortScript) {
    super(app);
    this.script = script;
  }

  onOpen(): void {
    const { contentEl, titleEl } = this;
    titleEl.setText(t().scriptModalTitle(this.script.title));
    contentEl.addClass("zoyclip-modal");

    contentEl.createEl("p", {
      cls: "zoyclip-meta",
      text: t().scriptModalMeta(this.script.segments.length, Math.round(this.script.total_est_seconds)),
    });

    const hook = contentEl.createDiv({ cls: "zoyclip-hook" });
    hook.createEl("strong", { text: t().hook });
    hook.createSpan({ text: this.script.hook });

    for (const seg of this.script.segments) {
      const box = contentEl.createDiv({ cls: "zoyclip-seg" });
      box.createDiv({ cls: "zoyclip-seg-meta", text: `#${seg.id} · ${seg.role} · ~${seg.est_seconds}s` });
      box.createDiv({ cls: "zoyclip-seg-text", text: seg.text });
      box.createDiv({ cls: "zoyclip-seg-sub", text: seg.subtitle_lines.join("  |  ") });
    }

    if (this.script.cta) {
      const cta = contentEl.createDiv({ cls: "zoyclip-cta" });
      cta.createEl("strong", { text: t().cta });
      cta.createSpan({ text: this.script.cta });
    }

    const row = contentEl.createDiv({ cls: "zoyclip-btnrow" });
    row.createEl("button", { text: t().copyJson }).addEventListener("click", async () => {
      await navigator.clipboard.writeText(JSON.stringify(this.script, null, 2));
      new Notice(t().copiedJson);
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
