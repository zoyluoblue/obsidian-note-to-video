// 自动配图：按关键词从 Pexels 免费图库取竖图。requestUrl 走 Obsidian（免 CORS）。
// 注：Pexels 免费 key 在 Authorization 头里直接放（不带 Bearer）。

import { writeFileSync } from "fs";
import { join } from "path";
import { requestUrl } from "obsidian";
import { t } from "../i18n";

async function pexelsOne(apiKey: string, query: string, dest: string): Promise<boolean> {
  try {
    const url =
      "https://api.pexels.com/v1/search?orientation=portrait&per_page=1&size=large&query=" + encodeURIComponent(query);
    const res = await requestUrl({ url, headers: { Authorization: apiKey }, throw: false });
    if (res.status < 200 || res.status >= 300) return false;
    const photo = res.json?.photos?.[0];
    const src: string | undefined =
      photo?.src?.large2x || photo?.src?.portrait || photo?.src?.large || photo?.src?.original;
    if (!src) return false;
    const img = await requestUrl({ url: src, throw: false });
    if (img.status < 200 || img.status >= 300) return false;
    writeFileSync(dest, Buffer.from(img.arrayBuffer));
    return true;
  } catch {
    return false;
  }
}

/**
 * 为每段取一张 Pexels 竖图，返回与段落对齐的绝对路径数组：
 * 某段取图失败 → 用前一张兜底（首段失败则回填首张成功的）；全失败返回 []（渲染层回退渐变）。
 */
export async function fetchPexelsImages(
  apiKey: string,
  queries: string[],
  tmpDir: string,
  onStep?: (m: string) => void,
  signal?: AbortSignal
): Promise<string[]> {
  const out: string[] = [];
  let last = "";
  for (let i = 0; i < queries.length; i++) {
    if (signal?.aborted) throw new Error("Canceled");
    onStep?.(t().images(i + 1, queries.length));
    const dest = join(tmpDir, `img_${i}.jpg`);
    const q = (queries[i] || "").trim() || "abstract minimal background";
    if (await pexelsOne(apiKey, q, dest)) {
      out.push(dest);
      last = dest;
    } else {
      out.push(last); // 兜底用上一张
    }
  }
  const firstReal = out.find((p) => p);
  if (!firstReal) return [];
  return out.map((p) => p || firstReal);
}
