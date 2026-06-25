// 双语 UI 文案。语言由设置 language("auto"|"en"|"zh") 决定；auto 跟随 Obsidian 界面语言。
// 用法：t().key 取静态串，t().fn(args) 取带参串。调 setUiLang() 切换当前语言。

export type UiLang = "en" | "zh";
export type LangSetting = "auto" | "en" | "zh";

const EN = {
  // 命令 / 图标 / 右键菜单（注：命令名在插件重载后才更新）
  cmdProduce: "Turn this note into a vertical short video",
  cmdCancel: "Cancel current video production",
  cmdGenScript: "Generate script only (preview)",
  ribbonTooltip: "ZoyClip: turn this note into a vertical short video",
  menuMakeVideo: "ZoyClip: make a vertical short video",

  // 通用提示
  openNoteFirst: "Open a note first.",
  setKeyFirst: (p: string) => `Set your ${p} API key in settings first.`,
  genScript: "ZoyClip: generating script…",
  scriptReady: (n: number, sec: number) => `Script ready (${n} segments, ~${sec}s)`,
  failed: (msg: string) => `Failed: ${msg}`,

  // 「仅生成脚本」预览弹窗
  scriptModalTitle: (title: string) => `Script: ${title}`,
  scriptModalMeta: (n: number, sec: number) => `${n} segments · ~${sec}s`,
  hook: "Hook ",
  cta: "CTA ",
  copyJson: "Copy script JSON",
  copiedJson: "Copied script JSON",

  // 出片前预览/编辑弹窗
  previewTitle: "Preview / edit script",
  previewMeta: (n: number, sec: number) => `${n} segments · ~${sec}s · edit, then click "Produce video"`,
  imageKeywords: "Image keywords",
  imageKeywordsPh: "e.g. office desk laptop",
  cancel: "Cancel",
  produceVideo: "Produce video",

  // 出片流程
  productionCanceled: "Production canceled.",
  productionFailed: (msg: string) => `Production failed: ${msg}`,
  scriptGenFailed: (msg: string) => `Script generation failed: ${msg}`,
  preparingInner: "preparing…",
  msgWrap: (m: string) => `ZoyClip: ${m}\n(click to cancel)`,
  kokoroNeedsApple: "Local Kokoro requires Apple Silicon; using the system voice this time.",
  kokoroSetupFailed: (err: string) => `Kokoro engine setup failed; using the system voice this time.\n${err}`,
  kokoroSynthFailed: (err: string) => `Kokoro synthesis failed; retrying with the system voice.\n${err}`,
  renderingImages: (n: number) => `rendering (${n} images)…`,
  renderingGradient: "rendering (gradient background)…",
  renderingPct: (p: number) => `rendering ${p}%…`,
  frameFallback: "Frame rendering failed; falling back to ffmpeg compositing.",
  writingNote: "writing to note…",
  generatingCover: "generating cover…",
  doneEmbedded: (sec: number, name: string) => `✅ Done (~${sec}s), embedded in "${name}".`,

  // 进度子消息（会被 msgWrap 包裹）
  voiceover: (i: number, n: number) => `voiceover ${i}/${n}…`,
  images: (i: number, n: number) => `images ${i}/${n}…`,

  // 首次自动下载
  dlEngineFirst: "First-time setup: downloading the local voice engine (~26MB, one time)…",
  dlEnginePct: (p: number) => `downloading engine ${p}%…`,
  extractingEngine: "extracting engine…",
  dlModelFirst: "First-time setup: downloading the voice model (one time)…",
  dlModelPct: (p: number) => `downloading model ${p}%…`,
  extractingModel: "extracting model…",
  dlFfmpegFirst: "First-time setup: downloading ffmpeg (~45MB, one time)…",
  dlFfmpegPct: (p: number) => `downloading ffmpeg ${p}%…`,
  dlFfprobeFirst: "First-time setup: downloading ffprobe (~45MB, one time)…",
  dlFfprobePct: (p: number) => `downloading ffprobe ${p}%…`,

  // 会冒泡给用户的报错
  noteEmpty: "Note is empty",
  apiKeyNotSet: (p: string) => `${p} API key not set (configure it in settings)`,
  llmRequestFailed: (s: number, body: string) => `LLM request failed ${s}: ${body}`,
  llmEmpty: "LLM returned empty content",
  llmNotJson: "LLM output is not valid JSON",
  scriptEmpty: "Script is empty (no valid segments)",
  ffmpegNotFound: "ffmpeg not found. Set its path in settings, or run: brew install ffmpeg",
  ffmpegNoX264: "ffmpeg is missing the libx264 encoder; install a full ffmpeg build",
  kokoroAppleOnly: "Local Kokoro currently runs on Apple Silicon (macOS arm64) only; it falls back to the system voice automatically.",
  voiceEngineFailed: "Voice engine setup failed (executable not found)",
  kokoroModelFailed: "Kokoro model setup failed",
  ffmpegAutoMacOnly: "ffmpeg not found, and auto-download supports macOS only. Install ffmpeg manually (brew install ffmpeg) or set its path in settings.",

  // 设置面板
  intro: "Set two keys before first use: (1) your LLM provider's API key (for the script); (2) a Pexels API key (for auto images), in the Output section below. Both are needed to produce a video.",
  hScript: "Script (cloud LLM)",
  hVoice: "Voice (Kokoro)",
  hOutput: "Output (frame rendering)",
  langName: "Language",
  langDesc: "Language of the plugin UI and the generated video (script / captions / voiceover). Auto follows Obsidian's language. Command and ribbon names update after you reload the plugin.",
  langAuto: "Auto (follow Obsidian)",
  langEn: "English",
  langZh: "中文",
  provName: "LLM provider",
  provDesc: "OpenAI by default; switch to DeepSeek if you prefer. Switching auto-fills the matching Base URL and default model (still editable).",
  baseName: "API Base URL",
  baseDesc: "OpenAI-compatible endpoint, auto-filled per provider; edit for self-hosted/proxy.",
  modelName: "Model",
  modelDesc: "Auto-filled per provider; change to another model name if you like.",
  keyName: (p: string) => `${p} API key`,
  keyDesc: (p: string) => `Stored locally in data.json (plain text). On first run your note text is sent to ${p}. Switching providers keeps the other key.`,
  maxName: "Max duration (seconds)",
  maxDesc: "Scripts longer than this trigger one compression pass.",
  prevName: "Preview / edit script before rendering",
  prevDesc: "After the script is generated, open a dialog to edit each segment's text and image keywords, then confirm to render.",
  voiceIdName: "Voice id (--sid)",
  voiceIdDesc: "Integer from 0; each number is a different voice. Change and re-render to audition.",
  capName: "Caption style",
  capDesc: "TikTok: few big words, popping in; Sentence: the full line shown at once.",
  capTikTok: "TikTok (big words, pop-in)",
  capSentence: "Sentence (full line)",
  pexName: "Pexels API key (auto images)",
  pexDesc: "Auto-pulls a vertical photo per segment from the free Pexels library (get a free key at pexels.com/api). Leave empty to use the manual images below.",
  imgName: "Images folder (manual, optional)",
  imgDesc: "Used when no Pexels key: a set of images for background/B-roll (switched per segment with Ken Burns + crossfade). You can also embed images in the note with ![[image]]. Otherwise a gradient background is used.",
  musName: "Background music folder (optional)",
  musDesc: "A set of audio files (mp3/wav...); one is picked at random per video and ducked under the voice. Leave empty for no music.",
  musVolName: "Background music volume",
  musVolDesc: "0–1, default 0.22 (ducked further while speaking).",
  coverName: "Generate cover image",
  coverDesc: "Also render a 9:16 cover (first image + big title) and embed it in the note.",
  ffName: "ffmpeg path",
  ffDesc: "Leave empty to auto-detect on PATH / common dirs, or auto-download on first use (macOS). Otherwise set the full path.",
  phPath: "vault-relative or absolute path",
  phPexels: "Pexels key",
};

const ZH: Record<keyof typeof EN, unknown> = {
  cmdProduce: "把当前笔记做成竖屏短视频",
  cmdCancel: "取消当前出片",
  cmdGenScript: "仅生成口播脚本（预览）",
  ribbonTooltip: "ZoyClip：把当前笔记做成竖屏短视频",
  menuMakeVideo: "ZoyClip：做成竖屏短视频",

  openNoteFirst: "请先打开一篇笔记。",
  setKeyFirst: (p: string) => `请先在设置里填写 ${p} API Key。`,
  genScript: "ZoyClip：正在生成脚本…",
  scriptReady: (n: number, sec: number) => `脚本生成完成（${n} 段，约 ${sec}s）`,
  failed: (msg: string) => `生成失败：${msg}`,

  scriptModalTitle: (title: string) => `口播脚本：${title}`,
  scriptModalMeta: (n: number, sec: number) => `${n} 段 · 约 ${sec} 秒`,
  hook: "钩子　",
  cta: "CTA　",
  copyJson: "复制脚本 JSON",
  copiedJson: "已复制脚本 JSON",

  previewTitle: "预览 / 编辑脚本",
  previewMeta: (n: number, sec: number) => `${n} 段 · 约 ${sec} 秒 · 改完点「生成视频」`,
  imageKeywords: "配图关键词",
  imageKeywordsPh: "如 office desk laptop",
  cancel: "取消",
  produceVideo: "生成视频",

  productionCanceled: "已取消出片。",
  productionFailed: (msg: string) => `出片失败：${msg}`,
  scriptGenFailed: (msg: string) => `脚本生成失败：${msg}`,
  preparingInner: "准备中…",
  msgWrap: (m: string) => `ZoyClip：${m}\n（点此取消）`,
  kokoroNeedsApple: "本地 Kokoro 仅支持 Apple Silicon，本次改用系统音色。",
  kokoroSetupFailed: (err: string) => `Kokoro 引擎准备失败，本次改用系统音色。\n${err}`,
  kokoroSynthFailed: (err: string) => `Kokoro 合成出错，本次改用系统音色重试。\n${err}`,
  renderingImages: (n: number) => `逐帧渲染（${n} 张图）…`,
  renderingGradient: "逐帧渲染（渐变背景）…",
  renderingPct: (p: number) => `渲染 ${p}%…`,
  frameFallback: "逐帧渲染出错，本次回退到 ffmpeg 合成。",
  writingNote: "写入笔记…",
  generatingCover: "生成封面…",
  doneEmbedded: (sec: number, name: string) => `✅ 出片完成（约 ${sec}s），已嵌入「${name}」。`,

  voiceover: (i: number, n: number) => `配音 ${i}/${n}…`,
  images: (i: number, n: number) => `配图 ${i}/${n}…`,

  dlEngineFirst: "首次准备：下载本地语音引擎（约 26MB，仅此一次）…",
  dlEnginePct: (p: number) => `下载引擎 ${p}%…`,
  extractingEngine: "解压引擎…",
  dlModelFirst: "首次准备：下载语音模型（仅此一次）…",
  dlModelPct: (p: number) => `下载模型 ${p}%…`,
  extractingModel: "解压模型…",
  dlFfmpegFirst: "首次准备：下载 ffmpeg（约 45MB，仅此一次）…",
  dlFfmpegPct: (p: number) => `下载 ffmpeg ${p}%…`,
  dlFfprobeFirst: "首次准备：下载 ffprobe（约 45MB，仅此一次）…",
  dlFfprobePct: (p: number) => `下载 ffprobe ${p}%…`,

  noteEmpty: "笔记内容为空",
  apiKeyNotSet: (p: string) => `未配置 ${p} API Key（请在设置中填写）`,
  llmRequestFailed: (s: number, body: string) => `LLM 请求失败 ${s}：${body}`,
  llmEmpty: "LLM 返回空内容",
  llmNotJson: "LLM 输出不是合法 JSON",
  scriptEmpty: "脚本为空（无有效段落）",
  ffmpegNotFound: "找不到 ffmpeg。请在设置里填 ffmpeg 路径，或 macOS 执行 brew install ffmpeg",
  ffmpegNoX264: "ffmpeg 缺少 libx264 编码器，请安装完整版 ffmpeg",
  kokoroAppleOnly: "本地 Kokoro 目前仅支持 Apple Silicon（macOS arm64）；其它情况自动回退系统音色。",
  voiceEngineFailed: "语音引擎准备失败（找不到可执行文件）",
  kokoroModelFailed: "Kokoro 模型准备失败",
  ffmpegAutoMacOnly: "未找到 ffmpeg，且自动下载仅支持 macOS。请手动安装 ffmpeg（brew install ffmpeg）或在设置里填路径。",

  intro: "使用前需配置两把 Key：① 下方 LLM 服务商的 API Key（生成脚本用）；② 「出片」分区里的 Pexels API Key（自动配图用）。两者都填了才能一键出片。",
  hScript: "脚本生成（云 LLM）",
  hVoice: "配音（Kokoro）",
  hOutput: "出片（逐帧渲染）",
  langName: "界面 / 输出语言",
  langDesc: "切换插件界面和生成视频（脚本 / 字幕 / 配音）的语言。Auto = 跟随 Obsidian。命令名和图标提示在重载插件后才更新。",
  langAuto: "Auto（跟随 Obsidian）",
  langEn: "English",
  langZh: "中文",
  provName: "LLM 服务商",
  provDesc: "默认 OpenAI，可切换到 DeepSeek。切换会自动填好对应的 Base URL 和默认模型（仍可手改）。",
  baseName: "API Base URL",
  baseDesc: "OpenAI 兼容端点，按服务商自动填；自建/代理可手改。",
  modelName: "模型",
  modelDesc: "按服务商自动填，可改成别的模型名。",
  keyName: (p: string) => `${p} API Key`,
  keyDesc: (p: string) => `存于本机 data.json（明文）。首次发送会把笔记正文发往 ${p}。切换服务商不会丢另一个 Key。`,
  maxName: "目标时长上限（秒）",
  maxDesc: "超出会触发一次压缩重写。",
  prevName: "出片前预览 / 编辑脚本",
  prevDesc: "生成脚本后先弹窗给你改每段文本和配图关键词，确认再渲染。",
  voiceIdName: "音色 id（--sid）",
  voiceIdDesc: "整数 0 起，每个数字一个音色。改后重新出片即可试听挑选。",
  capName: "字幕风格",
  capDesc: "TikTok：少字大字、逐块弹出；整句：整句一次显示。",
  capTikTok: "TikTok（少字大字弹出）",
  capSentence: "整句（整行）",
  pexName: "Pexels API Key（自动配图）",
  pexDesc: "填了就按每段关键词自动从 Pexels 免费图库配图（去 pexels.com/api 免费申请）。留空则用下面手动的图。",
  imgName: "图片文件夹（手动，可选）",
  imgDesc: "没填 Pexels key 时用：放一组图当背景/B-roll（按段落切换 + Ken Burns + 交叉淡化）。也可在笔记里 ![[图]] 嵌入。都没有则用渐变背景。",
  musName: "背景音乐文件夹（可选）",
  musDesc: "放一组音乐(mp3/wav...)，每条视频随机取一首；说话时自动压低(ducking)。留空则无背景乐。",
  musVolName: "背景音乐音量",
  musVolDesc: "0–1，默认 0.22（说话时还会再自动压低）。",
  coverName: "生成封面图",
  coverDesc: "额外出一张 9:16 封面（首图 + 大标题），嵌进笔记当封面用。",
  ffName: "ffmpeg 路径",
  ffDesc: "留空则自动在 PATH / 常见目录查找，或首次自动下载（macOS）。也可填完整路径。",
  phPath: "vault 相对路径 或 绝对路径",
  phPexels: "Pexels key",
};

const DICT = { en: EN, zh: ZH as typeof EN };

let current: UiLang = "en";

/** 把语言设置解析为具体语言：auto 跟随 Obsidian 界面语言（localStorage "language"），读不到回退英文。 */
export function resolveLang(setting: LangSetting): UiLang {
  if (setting === "zh" || setting === "en") return setting;
  try {
    const l = (window.localStorage.getItem("language") || "").toLowerCase();
    return l.startsWith("zh") ? "zh" : "en";
  } catch {
    return "en";
  }
}

export function setUiLang(l: UiLang): void {
  current = l;
}

export function t(): typeof EN {
  return DICT[current];
}
