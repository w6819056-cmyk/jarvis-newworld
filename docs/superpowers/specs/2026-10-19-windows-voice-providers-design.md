# Windows Voice Providers Design

## Goal

让 Windows 版 Jarvis 在设置中切换三种语音引擎：原项目同款 Codex Voice、豆包语音和现有本地语音，并保证任意时刻只有当前引擎拥有麦克风和播报通道。

## Context

原始 Tauri 项目已经通过本机 Codex app-server 的 `realtime_conversation` 和 WebRTC 接入 Codex Voice。当前 Electron Windows 版只迁移了文字 app-server、本地 sherpa-onnx ASR 和 Windows TTS，因此需要把 realtime 协议迁移到 Electron，而不是重新实现 Codex 语音服务。

## Architecture

设置状态新增 `voiceProvider: 'codex' | 'doubao' | 'local'`。`local` 保持现有 ASR/TTS；`doubao` 使用主进程持有 API Key 的双向 WebSocket ASR/TTS，Codex 继续通过文字 `turn/start` 处理请求；`codex` 使用 Electron 渲染进程的 `RTCPeerConnection` 生成 SDP offer，主进程通过 `thread/realtime/start` 将 offer 交给 Codex app-server，并把返回的 SDP answer 交回渲染进程。

Codex Voice 与文字会话共享同一个 thread。停止、切换设置、窗口关闭和 Codex 断开时必须先停止当前语音通道，再释放麦克风和音频播放资源。语音模式切换失败时保留原模式并显示可读错误，不静默回退到另一种模式。

## Scope

### In scope

- Settings/IPC 中保存和校验三种语音模式。
- CodexRuntime 启动 realtime app-server、检查 realtime 能力、发送 start/stop/appendText 请求。
- Electron preload/renderer 的 WebRTC offer、音频轨道和 Codex realtime 事件桥接。
- 统一语音拥有者生命周期，防止本地 ASR、豆包 ASR、Codex WebRTC 同时采集麦克风。
- 自动化测试覆盖设置校验、realtime 请求参数、模式切换和错误恢复。

### Out of scope

- 改动战甲模型、粒子、手势识别和动画。
- 把 API Key 写入前端、构建产物或日志。
- 在本阶段实现豆包协议；豆包只预留 provider 配置和生命周期接口，随后单独实现。

## Error Handling

- Codex 不支持 `thread/realtime/start` 或 WebRTC 时，Codex Voice 显示兼容性错误，文字模式仍可用。
- SDP 不合法、realtime 启动超时或会话关闭时，停止本地音频并将状态置为 `degraded`。
- 切换 provider 时若新 provider 启动失败，恢复切换前 provider 的状态；不得同时启动两个麦克风拥有者。
- 所有 renderer 错误只返回用户可读信息，app-server stderr 和密钥不转发到 renderer。

## Success Criteria

1. 设置页可以选择并持久化 `Codex Voice`、`豆包语音`、`本地语音`。
2. 安装兼容 Codex 后，选择 Codex Voice 能完成真实 WebRTC 语音会话，并收到转写、音频回答和工具审批事件。
3. 切换到本地语音后，现有本地识别和播报测试保持通过。
4. Codex Voice 启动失败时不会占用麦克风，且界面显示具体原因。
5. Windows 测试和构建命令通过。
