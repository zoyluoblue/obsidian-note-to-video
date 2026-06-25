// M1：把一篇笔记 → 竖屏口播脚本（云 LLM，OpenAI 兼容）。
// 流程：构造 prompt → 调 chat/completions(json_object) → 解析校验 → 时长校验 → 必要时压缩重写一次。

import { requestUrl } from "obsidian";
import type { ZoyClipSettings } from "../settings";
import type { Lang, Segment, ShortScript } from "../types";

const MAX_NOTE_CHARS = 8000;

/** 插件侧时长估算：中文 ~4.5 字/秒，英文 ~155 词/分。勿信模型自报秒数。 */
export function estSeconds(text: string, lang: Lang): number {
  if (lang === "zh") {
    const chars = [...text].filter((c) => /\S/.test(c)).length;
    return chars / 4.5;
  }
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return words / (155 / 60);
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function clampInt(v: unknown, min: number, max: number, dflt: number): number {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return dflt;
  return Math.min(max, Math.max(min, n));
}

function stripFences(s: string): string {
  const m = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return (m ? m[1] : s).trim();
}

/** 兜底断行：模型没给 subtitle_lines 时用。 */
function splitLines(text: string, lang: Lang): string[] {
  const t = text.trim();
  if (!t) return [];
  if (lang === "zh") {
    const chars = [...t];
    const out: string[] = [];
    for (let i = 0; i < chars.length; i += 12) out.push(chars.slice(i, i + 12).join(""));
    return out;
  }
  const out: string[] = [];
  let line = "";
  for (const w of t.split(/\s+/)) {
    if ((line + " " + w).trim().length > 42) {
      if (line) out.push(line.trim());
      line = w;
    } else {
      line = (line + " " + w).trim();
    }
  }
  if (line) out.push(line.trim());
  return out;
}

function systemPrompt(lang: Lang, maxS: number): string {
  const minS = Math.max(20, Math.min(45, maxS - 30));
  const langName = lang === "zh" ? "中文" : "英文";
  const wrap = lang === "zh" ? "中文每行约 12 个字" : "英文每行不超过 42 个字符";
  return [
    `你是竖屏短视频(9:16)口播脚本撰稿人。把用户给的笔记改写成${langName}、${minS}-${maxS} 秒的口播脚本。`,
    "要求：",
    "1) 开头 3 秒一句强钩子(疑问/反常识/痛点)，禁止寒暄铺垫。",
    "2) 主体 3-6 个口语化短段，每段只讲一个要点；各段内容必须互不相同，严禁重复同一句话或把同一个意思换个说法再说一遍，句子短、可被 2-4 秒切一次画面。",
    "3) 结尾一句明确 CTA(关注/评论/收藏 选其一)。",
    "4) 口语、第二人称，避免书面长句和专业堆砌。",
    `5) subtitle_lines 必须已按本语言断行：${wrap}。`,
    "6) 每段给一个 image_query：2-4 个英文词的画面搜索关键词，描述这段适合配什么实拍画面（用具体名词/场景，避免抽象词，便于图库检索）。",
    "7) 仅输出一个合法 JSON 对象（不要 markdown 代码块、不要任何解释文字），结构如下：",
    `{"lang":"${lang}","title":"...","hook":"...","cta":"...","segments":[{"id":1,"role":"hook|point|cta","text":"该段口播文本","subtitle_lines":["..."],"pause_after_ms":350,"image_query":"office desk laptop"}]}`,
  ].join("\n");
}

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

async function chat(settings: ZoyClipSettings, messages: ChatMessage[]): Promise<string> {
  const url = settings.apiBaseUrl.replace(/\/+$/, "") + "/chat/completions";
  const res = await requestUrl({
    url,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${settings.apiKey}`,
    },
    body: JSON.stringify({
      model: settings.model,
      messages,
      temperature: 0.7,
      response_format: { type: "json_object" },
    }),
    throw: false,
  });
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`LLM 请求失败 ${res.status}：${(res.text || "").slice(0, 200)}`);
  }
  const content: string | undefined = res.json?.choices?.[0]?.message?.content;
  if (!content) throw new Error("LLM 返回空内容");
  return content;
}

function parseScript(raw: string, lang: Lang): ShortScript {
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(stripFences(raw));
  } catch {
    throw new Error("LLM 输出不是合法 JSON");
  }

  const rawSegs: unknown[] = Array.isArray(obj?.segments) ? (obj.segments as unknown[]) : [];
  const seenText = new Set<string>(); // 去重：LLM 偶发返回重复段落 → 同文本只留一段，避免配音/字幕重复
  const segments: Segment[] = rawSegs
    .map((raw, i): Segment => {
      const s = (raw ?? {}) as Record<string, unknown>;
      const text = String(s.text ?? "").trim();
      const lines =
        Array.isArray(s.subtitle_lines) && s.subtitle_lines.length
          ? (s.subtitle_lines as unknown[]).map((x) => String(x))
          : splitLines(text, lang);
      const role = ["hook", "point", "cta"].includes(String(s.role)) ? (s.role as Segment["role"]) : "point";
      return {
        id: typeof s.id === "number" ? s.id : i + 1,
        role,
        text,
        subtitle_lines: lines,
        pause_after_ms: clampInt(s.pause_after_ms, 150, 800, 350),
        est_seconds: 0,
        image_query: String(s.image_query ?? "").trim() || undefined,
      };
    })
    .filter((s) => {
      if (!s.text) return false;
      const key = s.text.replace(/\s+/g, "").toLowerCase();
      if (seenText.has(key)) return false;
      seenText.add(key);
      return true;
    });

  if (!segments.length) throw new Error("脚本为空（无有效段落）");

  for (const s of segments) s.est_seconds = round1(estSeconds(s.text, lang) + s.pause_after_ms / 1000);
  const total = round1(segments.reduce((a, s) => a + s.est_seconds, 0));

  return {
    lang,
    title: String(obj?.title ?? "").trim() || "未命名",
    hook: String(obj?.hook ?? segments[0]?.text ?? "").trim(),
    cta: String(obj?.cta ?? "").trim(),
    segments,
    total_est_seconds: total,
  };
}

/** 入口：笔记正文 → 校验过的口播脚本。 */
export async function generateScript(settings: ZoyClipSettings, noteText: string, lang: Lang): Promise<ShortScript> {
  const text = noteText
    .replace(/^---[\s\S]*?---/, "") // 去掉 frontmatter
    .trim()
    .slice(0, MAX_NOTE_CHARS);
  if (!text) throw new Error("笔记内容为空");
  if (!settings.apiKey) throw new Error("未配置 API Key（请在设置中填写）");

  const sys = systemPrompt(lang, settings.targetSeconds);
  let script = parseScript(
    await chat(settings, [
      { role: "system", content: sys },
      { role: "user", content: text },
    ]),
    lang
  );

  if (script.total_est_seconds > settings.targetSeconds) {
    const msgs: ChatMessage[] = [
      { role: "system", content: sys },
      { role: "user", content: text },
      { role: "assistant", content: JSON.stringify(script) },
      {
        role: "user",
        content: `上面的脚本约 ${Math.round(script.total_est_seconds)} 秒，超过 ${settings.targetSeconds} 秒。请在同样结构下大幅精简，控制到 ${settings.targetSeconds} 秒以内，仍只输出合法 JSON。`,
      },
    ];
    try {
      const s2 = parseScript(await chat(settings, msgs), lang);
      if (s2.total_est_seconds <= script.total_est_seconds) script = s2;
    } catch {
      /* 压缩失败则保留首版 */
    }
  }
  return script;
}
