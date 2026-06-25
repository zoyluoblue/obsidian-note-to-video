# ZoyClip — Obsidian 笔记 → 竖屏口播短视频

把一篇笔记一键变成可直接发 TikTok / 小红书的 9:16 短视频。

- **脚本改写**：走云 LLM（DeepSeek / OpenAI 兼容）。⚠️ 笔记正文会发送到第三方云服务。
- **配音 TTS**：本地 **Kokoro**（sherpa-onnx + Kokoro int8 多语模型）。首次自动下载引擎(~26MB)+模型(~147MB)，之后纯本地、无服务、无 Python，中英双语。回退后端 macOS `say`。
- **出片渲染**：本地 ffmpeg，字幕卡用 Canvas 渲成 PNG 叠加（不依赖 libass/drawtext）。

> 仅桌面可用（`isDesktopOnly`）。脚本走云、TTS 与出片本地。

## 里程碑

- **M0 ✅** 脚手架 + 设置页 + 三入口（命令面板 / 右键 / ribbon）+ 读当前笔记
- **M1 ✅** 云 LLM 把笔记改写成竖屏口播脚本（结构化 + 时长校验 + 超时压缩重写），Modal 预览
- **M2 ✅** 本地 **Kokoro** 逐段配音（sherpa-onnx，引擎/模型首次自动下载，中英双语）→ narration.wav + 逐段时长；失败回退 `say`
- **M3 ✅** Canvas 字幕卡 PNG + ffmpeg 合成（渐变/纯色背景 + 波形 + 定时字幕）→ 9:16 mp4
- **M4 ✅** 端到端串联 + 落库 `![[out.mp4]]` + 进度提示 + ffmpeg 能力自检

## 开发

```bash
npm install
npm run build        # 产出 main.js
# 开发热构建：npm run dev
```

测试：把 `main.js` / `manifest.json` / `styles.css` 拷到某个 vault 的 `.obsidian/plugins/zoyclip/`，在 Obsidian 里启用插件，设置里填 API Key，然后对任意笔记跑「从当前笔记生成竖屏口播脚本」。

## 设置

- **API Base URL**：DeepSeek `https://api.deepseek.com`；OpenAI `https://api.openai.com/v1`
- **模型**：`deepseek-chat` / `gpt-4o-mini` 等
- **API Key**：存于本机 `data.json`（明文），建议在同步中排除本插件目录
- **默认语言** / **目标时长上限** / **ffmpeg 路径**（M3 起用）

## 许可

MIT（插件本体）。依赖各自许可：Kokoro Apache-2.0、ffmpeg 由用户自备。
