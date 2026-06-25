// ZoyClip 共享类型

export type Lang = "zh" | "en";
export type SegRole = "hook" | "point" | "cta";

/** 一段口播：一段文本 = 一张字幕卡 = TTS 的一个合成单元（MVP 粒度）。 */
export interface Segment {
  id: number;
  role: SegRole;
  /** 口播文本（喂给 TTS） */
  text: string;
  /** 已按语言断好行的字幕（Canvas 渲染字幕卡用） */
  subtitle_lines: string[];
  /** 段尾停顿，毫秒 */
  pause_after_ms: number;
  /** 插件侧估算时长（秒），含段尾停顿；非模型自报 */
  est_seconds: number;
  /** 该段配图的英文搜索关键词（LLM 生成，供 Pexels 等图源用） */
  image_query?: string;
}

/** 一条竖屏口播脚本。 */
export interface ShortScript {
  lang: Lang;
  title: string;
  hook: string;
  cta: string;
  segments: Segment[];
  total_est_seconds: number;
}
