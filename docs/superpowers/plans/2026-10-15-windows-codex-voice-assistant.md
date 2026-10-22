# Windows Jarvis implementation and handoff

Date: 2026-10-15
Branch: feat/windows-voice
Execution: inline, as requested; no subagents, no remote publish or merge.

## Agreed behavior

Manual launch on Windows 11 x64, original transparent character and formation visuals. Local wake phrase and speech recognition; Codex app-server handles text tasks; Windows native Chinese TTS speaks replies. Common app opening, web search and ordinary input need no conversational reconfirmation. Changes to user files require a specific spoken/text confirmation before execution. Native Codex approvals remain enabled and are surfaced. No app whitelist restricts the general Codex path.

## Delivered implementation

- [x] Isolated feature branch; macOS/Tauri entry retained.
- [x] Electron transparent window with sandbox/context isolation and validated IPC; pause, stop, settings, minimize, actual exit.
- [x] JSONL Codex client: discovery, initialize, thread start/resume, effective-policy verification, timeout/UTF8 handling, duplicate requests, modern/legacy approvals, dynamic tools, interrupt, owned-process-tree shutdown.
- [x] Verified danger-full-access / on-request / user reviewer against installed Codex 0.162.0-alpha.17.2.
- [x] One renderer microphone stream and AudioWorklet; local Sherpa model in a worker thread; wake homophones, same-breath command, endpoints, 30-second continuation, standalone voice stop.
- [x] Native Windows SpeechSynthesizer with text via stdin, cancellation and Chinese voice errors.
- [x] Direct validated browser/search/app-launch tools to avoid routine PowerShell launch approvals. General local operations remain available through Codex.
- [x] Original armor, shards, formation and particles reused; standalone Windows renderer and independent build.
- [x] Windows model download with checksum; NSIS build, source archive and local documentation. Windows CI added, not remotely run.
- [x] Unit tests and local build checks; real Codex round trip, effective policy, file-confirmation fixture and dynamic-tool routing checks.

## Architecture adjustments

The planned audio-coordinator module is implemented as renderer microphone ownership + asr-worker.ts + voice-gate.ts + windows-speech.ts, coordinated by main.ts. Process cleanup is in codex-runtime.ts. This keeps audio decoding away from animation while preserving a single microphone owner. Direct local tools are in local-tools.ts and windows-apps.ts.

Opening a URL/app means Windows accepted the request; it does not verify that the resulting UI fully loaded. A Codex rule can still request approval for other operations. File confirmation is a model/dialogue instruction, not an OS write interceptor.

## Remaining manual acceptance

- [ ] Fresh installation through the NSIS wizard, final packaged native-runtime loading, and uninstall.
- [ ] User microphone/voice/accent/noise: wake, browser search, follow-up and spoken file confirmation.
- [ ] Real packaged voice stop and microphone release/device changes under sustained use.
- [ ] Final hover-button behavior and visual scaling on additional displays.

Earlier development UI launched and its model loaded; pause button and text submission were exercised. The final UI was not re-controlled after the user stopped Computer Use with physical Escape. No further window input or application switching was performed.

Free-form full-duplex interruption is not implemented. During work or playback only standalone stop is acted on; other new tasks wait. Detached applications cannot reliably be terminated by killing the Codex process tree. These limits are documented instead of claimed complete.
