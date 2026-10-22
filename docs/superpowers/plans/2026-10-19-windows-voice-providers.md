# Windows Voice Providers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the original project's Codex Voice v3/WebRTC path in the Windows Electron app and expose Codex Voice, Doubao Voice, and Local Voice as selectable providers.

**Architecture:** Keep the existing text `CodexRuntime` session and add a realtime lifecycle to the same app-server child. The renderer owns the WebRTC `RTCPeerConnection` and microphone track for the Codex provider; the main process owns Codex protocol messages and all provider settings. Local voice remains the current worker/TTS path, while Doubao is represented by validated provider configuration and a provider boundary for the next implementation phase.

**Tech Stack:** Electron 44, TypeScript, Node test runner via `tsx`, Codex app-server JSONL protocol, browser WebRTC APIs, existing preload IPC bridge.

## Global Constraints

- Preserve existing armor, gesture, animation, local ASR, and text Codex behavior.
- Never expose API keys to renderer code or logs.
- Only one voice provider may own microphone/audio resources at a time.
- Codex Voice uses `approvalPolicy: on-request` and full local filesystem access already enforced by the current runtime.
- Production changes require a failing test first and focused Windows test runs.

### Task 1: Add provider settings and IPC validation

**Files:**
- Modify: `electron/protocol.ts`
- Modify: `tests/windows-protocol.test.ts`
- Modify: `electron/main.ts`
- Modify: `windows.html`
- Modify: `src/windows-main.ts`

**Interfaces:**
- `VoiceProvider = 'codex' | 'doubao' | 'local'`
- `Settings = { cwd: string; codexPath: string; voiceProvider: VoiceProvider; doubaoApiKey?: string; doubaoAsrResourceId?: string; doubaoTtsResourceId?: string; doubaoVoiceType?: string }`
- `Action.settings` accepts and returns the same shape with bounded strings.

- [x] Write a test proving `validateAction({type:'settings', ...})` accepts all three providers and rejects unknown providers.
- [x] Run `npx tsx --test tests/windows-protocol.test.ts` and verify the new test fails because the provider field is missing.
- [x] Implement the provider union, defaults, bounded validation, and backward-compatible default `local` for old settings files.
- [x] Add a compact settings selector and provider-specific fields to the existing settings dialog; save the selected provider through the existing action IPC.
- [x] Run the protocol test and the existing Windows UI/type checks.

### Task 2: Extend CodexRuntime with realtime protocol lifecycle

**Files:**
- Modify: `electron/codex-runtime.ts`
- Modify: `tests/windows-codex-runtime.test.ts`

**Interfaces:**
- `CodexRuntime.startRealtime({ sdp, voice? }): Promise<{ threadId: string; answerSdp?: string; realtimeSessionId?: string }>`
- `CodexRuntime.stopRealtime(): Promise<void>`
- `CodexRuntime.appendRealtimeText(text: string): Promise<void>`
- Runtime emits `thread/realtime/started`, `thread/realtime/error`, and `thread/realtime/closed` unchanged to existing listeners.

- [x] Add a fake app-server test asserting `startRealtime` sends `thread/realtime/start` with `version:'v3'`, `outputModality:'audio'`, WebRTC SDP, and the current thread ID.
- [x] Run the focused test and verify it fails because the methods do not exist.
- [x] Start the child process with `--enable realtime_conversation --stdio` when realtime is requested, while preserving text startup behavior.
- [x] Implement start/stop/append methods, forward asynchronous SDP events, and reject invalid SDP with Chinese user-facing errors.
- [x] Add shutdown cleanup that stops active realtime before killing the child.
- [x] Run all `windows-codex-runtime` tests.

### Task 3: Add renderer WebRTC bridge for Codex Voice

**Files:**
- Modify: `electron/preload.ts`
- Modify: `src/windows-main.ts`
- Modify: `src/windows.css`
- Modify: `tests/windows-voice.test.ts`

**Interfaces:**
- Bridge methods: `startCodexVoice(): Promise<void>`, `stopCodexVoice(): Promise<void>`, `appendCodexVoiceText(text: string): Promise<void>`.
- IPC channels: `jarvis:codex-voice-start`, `jarvis:codex-voice-stop`, `jarvis:codex-voice-text`, and `jarvis:codex-voice-event`.

- [x] Add a unit-level SDP event extraction test for the WebRTC bridge.
- [x] Run the focused test and verify it fails because the bridge helper is absent.
- [x] Implement `RTCPeerConnection` lifecycle with a local audio track, remote audio element, SDP offer/answer exchange, and deterministic cleanup.
- [x] Forward realtime SDP/state events to the renderer without changing armor signals.
- [x] Show provider-specific readiness text and retain the existing retry action.
- [x] Run the voice tests and TypeScript compilation.

### Task 4: Enforce provider ownership and switching

**Files:**
- Modify: `electron/main.ts`
- Modify: `electron/protocol.ts`
- Modify: `tests/windows-voice.test.ts`
- Modify: `tests/windows-wake-window.test.ts`

**Interfaces:**
- Internal `VoiceOwner` lifecycle: `start()`, `stop()`, `submitText(text)`, `isReady()`.
- `voiceProvider` selection determines the sole owner; switching stops the old owner before starting the new owner.

- [ ] Add a test proving switching from local to Codex stops local capture before starting realtime, and a failed switch restores the previous provider state.
- [x] Run the existing provider and runtime tests; the remaining ownership test is pending a dedicated provider abstraction.
- [x] Route Codex Voice through the WebRTC bridge and keep Doubao as a validated unavailable provider with a clear message until its implementation lands.
- [x] Update settings-save, retry, pause, stop, and quit paths to release the active local or Codex resources.
- [x] Run the complete Windows test suite.

### Task 5: Build and smoke-test Windows package

**Files:**
- Modify: `README.zh-CN.md`
- Modify: `docs/WINDOWS.md`

- [ ] Document the three providers, Codex Voice prerequisites, and the fact that Doubao credentials remain in the main process.
- [x] Run `npm run windows:test`.
- [x] Run `npm run windows:build`.
- [ ] Run the existing packaged visual/preflight checks and record any Codex compatibility limitation without claiming a live Voice session passed unless it was exercised.
