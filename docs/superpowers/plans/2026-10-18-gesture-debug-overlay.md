# Gesture Recognition Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the user the active camera image, hand skeleton, hand pose labels, and head direction while gesture mode is active.

**Architecture:** Reuse `GestureCamera`'s existing hidden video and worker callbacks. Add an optional diagnostics callback carrying the video frame source, current hand landmarks, and head direction; render that data in a UI-owned canvas and compact panel in `windows-main.ts`.

**Tech Stack:** TypeScript, DOM video/canvas, MediaPipe Tasks Vision, Node test runner, Vite, Electron.

## Global Constraints

- Do not open a second camera stream.
- Keep the panel hidden and stop the camera when gesture mode is off.
- Keep model controls and gesture actions unchanged.
- Clear hand landmarks when a hand is no longer detected.

---

### Task 1: Expose live preview diagnostics from GestureCamera

**Files:**
- Modify: `src/gesture/gesture-camera.ts`
- Test: `tests/windows-gesture-camera.test.ts`

**Interface:** Add `GesturePreviewFrame` with `video: HTMLVideoElement`, `hands: readonly GestureHand[]`, and `headDirection?: HeadDirection`. Add optional `onPreview` to `GestureCamera.start`; invoke after hand and face worker results and publish empty hands on stop/error.

- [x] Add tests verifying preview receives the existing video and recognized hand landmarks, then receives empty hands after a no-hand result and stop.
- [x] Run `npx tsx --test tests/windows-gesture-camera.test.ts` and confirm new assertions fail before implementation.
- [x] Implement the optional preview callback without opening another stream.
- [x] Re-run the focused test and `npm run windows:test`.

### Task 2: Add the camera preview and landmark overlay

**Files:**
- Modify: `src/windows-main.ts`
- Modify: `src/windows.css`
- Test: `tests/windows-gesture-camera.test.ts` for preview-state behavior where useful

**Interface:** Add a compact panel with video, transparent canvas, collapse button, per-hand labels, and head-direction label. Render the existing camera video mirrored with landmark points and the 21-point hand connections. Labels show handedness, Chinese pose name, finger count, and OK/pinch flags.

- [x] Add the preview panel hidden by default and its small-screen layout.
- [x] Add a canvas renderer that mirrors the existing camera view and draws MediaPipe hand connections and points.
- [x] Wire camera preview updates to render labels and clear stale points when hands disappear.
- [x] Add collapse/expand interaction and ensure preview is hidden on camera stop/error.
- [x] Run Windows gesture tests and `npm run windows:build`.

### Task 3: Verify the desktop experience

**Files:**
- Verify: `scripts/check-desktop-visuals.cjs`

- [x] Run `npx electron scripts/check-desktop-visuals.cjs` and confirm ordinary idle layout remains intact.
- [x] Run `npm run windows:test` and confirm all tests pass.
- [x] Inspect git diff for scope and confirm existing controls and gesture actions were not changed.
