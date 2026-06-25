import { App, MarkdownView, Menu, Modal, Notice, Plugin, TAbstractFile, TFile } from "obsidian";
import { DEFAULT_SETTINGS, ZoyClipSettings, ZoyClipSettingTab } from "./settings";
import { generateScript } from "./pipeline/script";
import { produceVideo } from "./pipeline/assemble";
import type { ShortScript } from "./types";

export default class ZoyClipPlugin extends Plugin {
  settings: ZoyClipSettings = DEFAULT_SETTINGS;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.addSettingTab(new ZoyClipSettingTab(this.app, this));

    this.addRibbonIcon("clapperboard", "ZoyClip：把当前笔记做成竖屏短视频", () => {
      void this.withActiveFile((f) => produceVideo(this, f));
    });

    this.addCommand({
      id: "produce-video",
      name: "把当前笔记做成竖屏短视频（完整出片）",
      checkCallback: (checking) => this.activeFileCallback(checking, (f) => produceVideo(this, f)),
    });

    this.addCommand({
      id: "generate-script",
      name: "仅生成口播脚本（预览）",
      checkCallback: (checking) =>
        this.activeFileCallback(checking, (f) => this.previewScript(f)),
    });

    this.registerEvent(
      this.app.workspace.on("file-menu", (menu: Menu, file: TAbstractFile) => {
        if (file instanceof TFile && file.extension === "md") {
          menu.addItem((item) =>
            item
              .setTitle("ZoyClip：做成竖屏短视频")
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
      new Notice("请先打开一篇笔记。");
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
    if (!this.settings.apiKey) {
      new Notice("请先在设置里填写 API Key。");
      return;
    }
    const notice = new Notice("ZoyClip：正在生成脚本…", 0);
    try {
      const raw = await this.app.vault.cachedRead(file);
      const script = await generateScript(this.settings, raw, this.settings.defaultLang);
      notice.hide();
      new Notice(`脚本生成完成（${script.segments.length} 段，约 ${Math.round(script.total_est_seconds)}s）`);
      new ScriptModal(this.app, script).open();
    } catch (e) {
      notice.hide();
      new Notice(`生成失败：${e instanceof Error ? e.message : String(e)}`);
      console.error("[ZoyClip]", e);
    }
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
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
    titleEl.setText(`口播脚本：${this.script.title}`);
    contentEl.addClass("zoyclip-modal");

    contentEl.createEl("p", {
      cls: "zoyclip-meta",
      text: `语言 ${this.script.lang} · ${this.script.segments.length} 段 · 约 ${Math.round(this.script.total_est_seconds)} 秒`,
    });

    const hook = contentEl.createDiv({ cls: "zoyclip-hook" });
    hook.createEl("strong", { text: "钩子　" });
    hook.createSpan({ text: this.script.hook });

    for (const seg of this.script.segments) {
      const box = contentEl.createDiv({ cls: "zoyclip-seg" });
      box.createDiv({ cls: "zoyclip-seg-meta", text: `#${seg.id} · ${seg.role} · ~${seg.est_seconds}s` });
      box.createDiv({ cls: "zoyclip-seg-text", text: seg.text });
      box.createDiv({ cls: "zoyclip-seg-sub", text: seg.subtitle_lines.join("　|　") });
    }

    if (this.script.cta) {
      const cta = contentEl.createDiv({ cls: "zoyclip-cta" });
      cta.createEl("strong", { text: "CTA　" });
      cta.createSpan({ text: this.script.cta });
    }

    const row = contentEl.createDiv({ cls: "zoyclip-btnrow" });
    row.createEl("button", { text: "复制脚本 JSON" }).addEventListener("click", async () => {
      await navigator.clipboard.writeText(JSON.stringify(this.script, null, 2));
      new Notice("已复制脚本 JSON");
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
