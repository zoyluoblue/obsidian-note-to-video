// 出片前预览 / 编辑：弹窗里改每段口播文本和配图关键词，确认后再渲染。
import { App, Modal } from "obsidian";
import type { ShortScript } from "../types";
import { t } from "../i18n";

/** 打开预览弹窗。返回编辑后的脚本；用户取消/关闭返回 null。 */
export function editScriptInModal(app: App, script: ShortScript): Promise<ShortScript | null> {
  return new Promise((resolve) => new PreviewModal(app, script, resolve).open());
}

class PreviewModal extends Modal {
  private script: ShortScript;
  private resolve: (s: ShortScript | null) => void;
  private confirmed = false;

  constructor(app: App, script: ShortScript, resolve: (s: ShortScript | null) => void) {
    super(app);
    this.script = JSON.parse(JSON.stringify(script)); // 深拷贝，编辑不影响原对象
    this.resolve = resolve;
  }

  onOpen(): void {
    const { contentEl, titleEl } = this;
    titleEl.setText(t().previewTitle);
    contentEl.addClass("zoyclip-modal");
    contentEl.createEl("p", {
      cls: "zoyclip-meta",
      text: t().previewMeta(this.script.segments.length, Math.round(this.script.total_est_seconds)),
    });

    const list = contentEl.createDiv({ cls: "zoyclip-seglist" });
    this.script.segments.forEach((seg, i) => {
      const box = list.createDiv({ cls: "zoyclip-seg" });
      box.createDiv({ cls: "zoyclip-seg-meta", text: `#${i + 1} · ${seg.role}` });

      const ta = box.createEl("textarea", { cls: "zoyclip-edit-text" });
      ta.value = seg.text;
      ta.rows = 2;
      ta.addEventListener("input", () => (seg.text = ta.value));

      const qrow = box.createDiv({ cls: "zoyclip-edit-row" });
      qrow.createSpan({ cls: "zoyclip-edit-label", text: t().imageKeywords });
      const qi = qrow.createEl("input", { type: "text", cls: "zoyclip-edit-query" });
      qi.value = seg.image_query || "";
      qi.placeholder = t().imageKeywordsPh;
      qi.addEventListener("input", () => (seg.image_query = qi.value.trim()));
    });

    const row = contentEl.createDiv({ cls: "zoyclip-btnrow" });
    row.createEl("button", { text: t().cancel }).addEventListener("click", () => this.close());
    const go = row.createEl("button", { text: t().produceVideo, cls: "mod-cta" });
    go.addEventListener("click", () => {
      this.script.segments = this.script.segments.filter((x) => x.text.trim().length > 0);
      this.confirmed = true;
      this.resolve(this.script);
      this.close();
    });
  }

  onClose(): void {
    this.contentEl.empty();
    if (!this.confirmed) this.resolve(null); // 关闭/取消 = null
  }
}
