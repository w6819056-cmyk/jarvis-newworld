# Voice-Triggered Armor Inspection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the original 2D helmet as the default view and add a local voice flow that shows the full armor, enables gestures, and returns on “结束检查”.

**Architecture:** Electron main recognizes exact local inspection commands and emits typed signals. The renderer owns an idempotent inspection controller that coordinates the Three.js model, original helmet image, camera, and gesture smoother. The Three.js scene starts with its model hidden.

**Tech Stack:** Electron 44, TypeScript, Three.js 0.186, Node test runner via `tsx`.

## Global Constraints

- The full-body model stays hidden at startup; the original helmet stays visible.
- Enter requires the wake gate, including a wake phrase and command in one utterance; exit works without a wake phrase while inspection is active.
- Voice inspection commands never reach Codex.
- Camera access is video-only, starts on inspection entry, and stops on exit or window shutdown.
- Camera failure leaves the full model visible and permits retry from the existing gesture button.
- Open palm scatters; fist assembles; uncertain poses and tracking loss preserve the current target.

---

## File Map

- `electron/inspection-commands.ts`: exact local command normalization and mode-aware recognition.
- `electron/main.ts`: intercept enter/exit before Codex submission and emit typed renderer signals.
- `electron/protocol.ts`: add inspection signal types to the preload bridge.
- `src/helmet/helmet-scene.ts`: expose model visibility and keep it hidden until entry.
- `src/armor-inspection.ts`: coordinate scene visibility, camera startup/stop, and gesture reset.
- `src/windows-main.ts`: connect command signals to the controller; retain the existing manual camera retry control.
- `tests/windows-inspection-commands.test.ts`, `tests/windows-armor-inspection.test.ts`: cover command matching and lifecycle behavior.
- `scripts/check-desktop-visuals.cjs`: verify the default and inspection visibility states in Electron.
- `scripts/check-installed-desktop.mjs`, `docs/WINDOWS.md`: verify and explain the new default and voice flow.

## Task 1: Recognize Local Commands

**Interfaces:** `matchInspectionCommand(text: string, active: boolean): 'enter' | 'exit' | undefined` ignores harmless punctuation and whitespace, recognizes only the exact phrases `检查一下战甲` and `结束检查`, and respects whether inspection is active.

- [x] Add tests for exact enter/exit phrases, punctuation/spacing, rejecting extra words, and requiring active inspection for exit.
- [x] Run `npx tsx --test tests/windows-inspection-commands.test.ts`; confirm failure because the module is absent.
- [x] Implement the pure matcher and rerun the focused test.
- [x] In `electron/main.ts`, intercept the end command before `VoiceGate.accept` while active; intercept entry only from `result.text` after the wake gate; set active state before emitting typed signals; publish local transcript/status without calling `submit`.
- [x] Run the matcher and existing `tests/windows-voice.test.ts` tests.

## Task 2: Add Inspection Lifecycle and Model Visibility

**Interfaces:** `ArmorInspection` receives `setVisible(boolean)`, `startCamera(): Promise<void>`, `stopCamera()`, `resetGestures()`, and `setDispersal(number)` callbacks. `enter()` is idempotent and leaves the model visible if camera startup rejects. `exit()` is idempotent, stops camera first, resets dispersal to zero, and hides the model.

- [x] Add tests for enter ordering, repeated enter, camera failure preserving visible inspection, exit ordering, and repeated exit.
- [x] Run the focused test and confirm it fails because the lifecycle module is absent.
- [x] Implement the smallest controller that satisfies those tests.
- [x] Add `HelmetScene.setVisible(boolean)` and ensure newly loaded armor meshes inherit the current hidden/visible state.
- [x] Connect the controller and typed signals in `src/windows-main.ts`; auto-start video-only gestures on entry; keep manual retry available; restore image visibility on exit.
- [x] Run the two new tests and all existing Windows gesture/helmet tests.

## Task 3: Verify the Desktop Experience

- [x] Extend the Electron visual check to assert startup shows the original helmet and hides the GLB, inspection shows the loaded model, and exit restores the helmet with camera off.
- [x] Run `npm run windows:test`, `npm run windows:build`, and `npx electron scripts/check-desktop-visuals.cjs`.
- [x] Inspect the final diff and confirm no unrelated worktree changes were staged or modified.

## Self-Review

- Spec coverage: startup fallback, local command interception, same-utterance wake, exit without re-wake, automatic video-only camera startup, denial/retry, palm/fist behavior, and immediate cleanup are assigned to Tasks 1-3.
- Placeholder scan: no deferred implementation steps or unspecified interfaces remain.
- Type consistency: typed signals carry `inspection-enter | inspection-exit`; the renderer controller exposes `enter()` and `exit()`; scene visibility and gesture target use explicit booleans/numbers.
