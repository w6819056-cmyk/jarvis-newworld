# Jarvis New World

Windows desktop voice assistant built around Codex. Jarvis stays quietly in the background, wakes on “嗨 Jarvis” or “Hi Jarvis”, and gives the user a visual, local-first control surface for voice, text, tools, maps, weather, music, and desktop tasks.

This repository is the Windows-focused continuation of the original Jarvis interface. It is an Electron application with a TypeScript renderer and a protected main-process runtime. The goal is a practical desktop assistant that can understand a natural request and route it to the right local module.

## What Jarvis can do

- **Three voice providers:** Codex Voice, Doubao streaming ASR/TTS, and the local speech engine. The provider is selected in Settings; typed input remains available as a fallback.
- **Wake and conversation flow:** background wake listening, visible transcript of the current utterance, interruption/stop controls, task status, spoken responses, and local conversation history.
- **Codex work channel:** continues a workspace thread, sends voice or typed requests to Codex, and exposes permission-aware task execution.
- **Windows control:** launch applications, activate windows, inspect system resources, control volume, list processes, and run Windows UI Automation for supported foreground-window workflows.
- **Desktop visual interface:** transparent Jarvis helmet, particle assembly, armor inspection mode, gesture-controlled armor interaction, selectable components, and status HUDs that appear only when needed.
- **Map module:** an internal browser window for AMap search, nearby food and places, route planning, and in-module navigation. It is controlled by Jarvis through restricted IPC and is not a separate installed application.
- **Rainform module:** local rain visualization driven by weather data. Ask for the nearest rainy city in China or the rain intensity in a named city, then inspect the result in the rain module.
- **Mineradio module:** play/pause, next/previous, volume, search and play, and visual preset switching. Say “换一个音乐效果” to choose a random preset or name a specific preset.
- **HUD answers:** weather, search, media and module results can be shown as compact in-world panels next to the helmet instead of taking over the whole screen.
- **Local memory:** conversation text and metadata are stored in a local SQLite archive. No audio recordings or raw voice data are stored by Jarvis.

## Typical commands

```text
嗨 Jarvis，打开浏览器搜索今天的天气
帮我看看附近有什么美食
导航到郑州东站
现在离我们最近的哪个城市在下雨
郑州现在的雨有多大
播放一首音乐，换一个音乐效果
开始工作了贾维斯
结束工作
```

The exact available actions depend on the configured provider, API credentials, installed applications, and the state of each module. High-risk file or process operations should be confirmed through the configured Codex permission policy.

## Architecture

```text
Microphone / typed input
        ↓
Wake gate and speech provider (Codex / Doubao / local)
        ↓
Electron main process and command routing
        ├── Codex workspace runtime and local memory
        ├── Windows system and UI Automation tools
        ├── Mineradio bridge
        ├── Holo-map module
        ├── Rainform module
        └── Jarvis visual window and HUDs
```

Renderer windows communicate with the main process through isolated preload APIs and restricted IPC. Module windows do not receive unrestricted Node.js or filesystem access.

## Requirements

- Windows 10/11, with Windows 11 recommended
- Node.js 20 or later
- Codex App/CLI installed and signed in when using Codex Voice or Codex tasks
- A microphone for wake and voice control
- Optional: Doubao API credentials, AMap JS API credentials, and QWeather credentials
- Optional: Mineradio installation for music controls

## Development

```bash
npm ci
npm run windows:test
npm run windows:build
npm run dev
```

To create a Windows installer:

```bash
npm run windows:dist
```

Build outputs are written to the local `dist-windows/` or Electron Builder output directories and are intentionally ignored by Git.

## Configuration

Open Jarvis Settings to choose the voice provider and enter module credentials. Secrets are stored in the local application configuration and are not committed to this repository. Do not place API keys, tokens, commercial audio, or unlicensed model files in Git.

For the map module, configure an AMap JS API key and security code. For Rainform, configure the weather API host and key. Doubao requires the API key plus the ASR and TTS resource identifiers required by the selected streaming services.

## Privacy and safety

- Voice audio is sent only to the selected voice provider while that provider is active.
- Conversation text is stored locally for search and semantic memory; raw audio is not archived.
- The map and weather modules receive only the data needed for their requested operation.
- `.env` files, local credentials, SSH keys, runtime data, installers, private models, and user-provided music are excluded from version control.
- Codex permission profiles remain the authority for workspace and high-risk operations.

## Project status

Jarvis New World is an actively developed Windows desktop project. Voice providers and module integrations are evolving, so service availability and provider protocol changes may require compatibility updates. The source repository is the canonical development artifact; generated installers and local runtime data are not part of the source distribution.

## License

The core project is released under the [GNU General Public License v3.0](LICENSE). Third-party modules and assets retain their own licenses; see the accompanying license files and notices before redistribution.
# jarvis-newworld
