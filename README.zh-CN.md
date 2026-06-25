# ZoyClip — 笔记 → 竖屏短视频

[English](README.md) | [中文](README.zh-CN.md)

把任意笔记一键变成可直接发 **TikTok、Instagram Reels、YouTube Shorts、小红书** 的 **9:16 竖屏短视频**——本地 AI 配音、自动配图、动态字幕、背景音乐，外加一张自动生成的封面。**中英双语。** 全程本地、免费、无水印。

> 一篇笔记进 → 一条 1080×1920 的成片 MP4（外加封面图）直接嵌回你的笔记。

## 它能做什么

1. **脚本** —— 通过云端 LLM（**OpenAI** 或 **DeepSeek**，OpenAI 兼容）把你的笔记改写成有钩子、分段的口播脚本。
2. **配音** —— 用 **Kokoro TTS**（基于 sherpa-onnx）在**本地**合成中文/英文旁白。引擎 + 模型首次自动下载一次，之后纯离线——无需 Python、无需服务。不可用时回退系统音色。
3. **配图** —— 按 AI 生成的关键词自动从 **Pexels** 给每段取一张竖图，或用笔记里嵌入的图 / 指定文件夹里的图。带 Ken Burns 缓慢推拉 + 段间交叉淡化。
4. **字幕** —— 跟随语音的单行字幕（动态、大字、易读，支持中日韩断行）。
5. **音乐** —— 可选背景音乐，说话时自动压低（ducking）。
6. **封面** —— 自动生成一张封面图（标题 + 首图），用作缩略图/点开页。
7. **合成** —— 用 **ffmpeg** 把一切合成 9:16 的 MP4，并嵌回你的笔记。

## 语言

在设置里把整个插件——界面**和**生成的视频（脚本/字幕/配音）——在 **English** 与 **中文** 之间切换。默认 **Auto** 跟随你的 Obsidian 界面语言。

## 隐私与网络使用

ZoyClip 以本地为先。下面每一次联网都由你出片时主动触发，**没有任何用于统计/遥测的请求**：

- **云端 LLM（必需）。** 你的笔记正文会用**你自己的 API key** 发送到你配置的 LLM 端点（**OpenAI** `api.openai.com`、**DeepSeek** `api.deepseek.com`，或你填的任意 OpenAI 兼容地址），用于改写成脚本。这是唯一会把你笔记内容传出本机的步骤。
- **Pexels（可选）。** 如果你填了 Pexels API key，会把简短的英文配图关键词（不是你的笔记正文）发到 `api.pexels.com` 拉取素材图。
- **一次性下载开源工具**（从公开的 GitHub Releases），随后通过 Node `child_process` 在本地运行：
  - **ffmpeg** 静态二进制 —— 来自 [`eugeneware/ffmpeg-static`](https://github.com/eugeneware/ffmpeg-static)（仅 macOS；也可在设置里填你自己的 ffmpeg）。
  - **sherpa-onnx** TTS 引擎 + **Kokoro** 语音模型 —— 来自 [`k2-fsa/sherpa-onnx`](https://github.com/k2-fsa/sherpa-onnx)。
  这些都缓存在插件目录里、之后离线复用。**绝不下载任何会成为插件一部分的代码。**
- **临时文件。** 出片渲染过程中，插件会在系统临时目录写入临时音频/帧，完成后自动删除。

无统计、无遥测、无广告。你生成的音频和视频永远不离开你的电脑。

## 环境要求

- **桌面版** Obsidian（仅桌面——用到 Node/Electron API；`isDesktopOnly`）。
- 本地 Kokoro 配音需要 **Apple Silicon Mac**（其它平台会回退系统音色）。
- **ffmpeg** —— macOS 首次使用时自动下载，或在设置里填路径 / `brew install ffmpeg`。
- 一个 **OpenAI** 或 **DeepSeek** 的 API key（用于脚本步骤）。
- *(可选)* 一个免费的 **Pexels** API key（用于自动配图）—— 去 [pexels.com/api](https://www.pexels.com/api/) 申请。

## 安装

**从社区商店**（上架后）：设置 → 第三方插件 → 浏览 → 搜索 **ZoyClip**。

**从源码 / BRAT：**

```bash
git clone https://github.com/zoyluoblue/obsidian-note-to-video
cd obsidian-note-to-video
npm install
npm run build        # 产出 main.js
```

把 `main.js`、`manifest.json`、`styles.css` 拷进 `<你的库>/.obsidian/plugins/zoyclip/`，在 Obsidian 里启用插件，在设置里填好 API key，然后对任意笔记执行命令 **「把当前笔记做成竖屏短视频」**。

## 设置项

- **语言** —— Auto（跟随 Obsidian）/ English / 中文 —— 同时切换界面**和**输出。
- **LLM** —— 服务商（OpenAI / DeepSeek）、Base URL、模型、API key。
- **配音** —— Kokoro 音色 id（改了重新出片即可试听）。
- **字幕** —— TikTok（少字大字、逐块弹出）或整句风格。
- **配图** —— Pexels API key（自动）—— 或图片文件夹 / `![[嵌入图]]`（手动）。
- **音乐** —— 一个音乐文件夹（随机取一首 + ducking）+ 音量。
- **封面** —— 是否生成封面图。
- **预览** —— 渲染前先编辑脚本和配图关键词。
- **ffmpeg 路径** —— 可选（否则自动查找/自动下载）。

## 它如何做到本地 & 免费

- **配音**通过 **Kokoro + sherpa-onnx** 在本地跑——没有云端 TTS 账单。
- **渲染**用原生 **ffmpeg** 加一个复用 Obsidian 自带 Chromium 的应用内 Canvas 逐帧渲染器——不带第二个浏览器、不打包原生二进制。
- 只有**脚本改写**用到云端 LLM（你自己的 key）；你的音频和视频永远不离开本机。

## 许可

MIT —— 见 [LICENSE](LICENSE)。第三方组件保留各自许可：**Kokoro**（Apache-2.0）、**sherpa-onnx**（Apache-2.0）、**ffmpeg**（下载的静态构建，按构建为 LGPL/GPL）、Pexels 图片遵循 [Pexels License](https://www.pexels.com/license/)。
