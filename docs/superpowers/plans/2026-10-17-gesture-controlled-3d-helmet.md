# Gesture-Controlled 3D Helmet Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the supplied full-body Iron Man GLB into named anatomical regions and render them on a transparent Three.js canvas. An open palm scatters all regions; a fist reassembles them.

**Architecture:** Render the helmet and fragments in a transparent Three.js canvas. A manually enabled webcam feeds a locally bundled MediaPipe Hand Landmarker in a renderer worker; only a smoothed `open | fist | neutral | lost` state reaches the scene. Camera tracks stop immediately when gesture mode is disabled, and the existing 2D helmet remains the WebGL fallback.

**Tech Stack:** Electron 44.7.2, Vite 8.1.5, Three.js 0.186.1, `@types/three` 0.186.0, MediaPipe Tasks Vision 1.1.1, Node test runner via `tsx`.

## Global Constraints

- Gesture mode is off on every app launch and camera capture starts only after the user enables it.
- Camera capture is video-only, local, never previewed, recorded, persisted, or sent to Codex.
- Hand inference runs at 10-15 samples per second; animated Three.js output follows the display refresh rate and pauses when settled.
- An open palm or fist must exceed 0.75 confidence for 250 ms before changing the target blend; neutral and low-confidence poses leave it unchanged.
- Tracking loss preserves the current blend; disabling gesture mode stops camera tracks and returns fragments to the assembled state.
- Split the supplied GLB into named body-region meshes, preserving every source triangle and its UV/normal/tangent/material data. Preserve the centered composition, transparent background, click-through behavior, and existing voice behavior. The Grant Riley model remains subject to CC BY-NC 4.0 attribution and non-commercial terms.
- The locally bundled model URL is `https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`; its verified SHA-256 is `fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1` (7,819,105 bytes).
- Bump the Windows app from 0.2.9 to 0.3.0 when packaging the complete feature. Never enable camera capture during build or test startup.

---

## File Map

- `src/helmet/helmet-geometry.ts`: split source triangles into named anatomical regions and assign stable assembled/scattered transforms.
- `src/helmet/helmet-scene.ts`: own the transparent WebGL renderer, lighting, resize, wake formation, and render lifecycle.
- `src/gesture/hand-gesture.ts`: pure landmark classification and confidence/hysteresis state.
- `src/gesture/hand-landmarker.worker.ts`: run MediaPipe inference off the renderer main thread.
- `src/gesture/gesture-camera.ts`: own the hidden video element, camera permission, frame transfer, worker lifecycle, and guaranteed track cleanup.
- `src/windows-main.ts` and `src/windows.css`: replace the 2D character surface with the Three.js canvas and add the mode toggle plus persistent camera-active/error indicator.
- `scripts/download-hand-landmarker.mjs`, `scripts/preflight-windows.ts`, `scripts/build-windows.mjs`, `package.json`, and `package-lock.json`: pin and verify the local model and dependencies before packaging; copy MediaPipe WASM into the renderer output.
- `docs/THIRD-PARTY-NOTICES.md` and `docs/licenses/`: include MediaPipe and model notices required by upstream terms.
- `tests/windows-gesture-assets.test.ts`, `tests/windows-gesture.test.ts`, `tests/windows-gesture-camera.test.ts`, and `tests/windows-helmet.test.ts`: cover asset integrity, pure state, lifecycle, and geometry contracts.
- `scripts/check-desktop-visuals.cjs` and `scripts/check-installed-desktop.mjs`: verify renderer output and the packaged Windows app.
- `docs/WINDOWS.md` and `outputs/Windows-Jarvis-使用说明.md`: document gesture mode, camera status, permission failure, and local processing.

## Task 1: Pin Dependencies and Bundle the Local Hand Model

**Files:**
- Modify: `package.json`, `package-lock.json`, `scripts/preflight-windows.ts`, `scripts/download-windows-model.ps1`, `scripts/build-windows.mjs`
- Create: `scripts/download-hand-landmarker.mjs`, `tests/windows-gesture-assets.test.ts`, `public/models/hand_landmarker.task`
- Modify: `.gitignore`, `docs/THIRD-PARTY-NOTICES.md`, `docs/licenses/`

**Interfaces:**
- `export function verifyAsset(bytes: Uint8Array, expectedSize: number, expectedSha256: string): boolean` is a generic deterministic integrity check; `verifyHandModel(bytes: Uint8Array): boolean` applies the pinned model size/hash in Global Constraints.
- `download-hand-landmarker.mjs` downloads the exact URL in Global Constraints to `public/models/hand_landmarker.task`, then verifies the exact byte count and SHA-256 before returning exit code 0.
- `npm run windows:models` downloads both the existing Sherpa speech model and the pinned hand model. `npm run windows:preflight` fails with the exact missing asset path and command if either is absent.

- [ ] **Step 1: Write the failing asset verification test.** In `tests/windows-gesture-assets.test.ts`, use `Buffer.from('hand-model-fixture')` and its literal SHA-256 to verify `verifyAsset` accepts the exact bytes, rejects a changed byte, and rejects the wrong byte count. Add an integration assertion for `verifyHandModel` after the official asset is downloaded.
- [ ] **Step 2: Run `npm run windows:test` and confirm the new test fails because `verifyHandModel` is missing.** Existing Windows tests must remain green.
- [ ] **Step 3: Add exact dependencies.** Run `npm install --save-exact three@0.186.1 @mediapipe/tasks-vision@1.1.1` and `npm install --save-dev --save-exact @types/three@0.186.0`; update the root package version to `0.3.0`.
- [ ] **Step 4: Implement the downloader.** Export `verifyAsset` and `verifyHandModel`; use Node `fetch`, stream to a temporary file, verify length/hash, then atomically move to `public/models/hand_landmarker.task`. Delete the temporary file on success or failure.
- [ ] **Step 5: Add the verified model download to `windows:models` and preflight.** Keep the existing speech-model download behavior and fail closed if the hand model hash differs. Ignore the downloaded model in `.gitignore`; Vite copies it from `public`, and `scripts/build-windows.mjs` copies `node_modules/@mediapipe/tasks-vision/wasm/*` to `dist-windows/mediapipe/wasm/`.
- [ ] **Step 6: Include notices.** Record the exact npm package versions, official model URL, attribution, and applicable license text in third-party notices; do not package the model until its license text is included.
- [ ] **Step 7: Run `npm run windows:models`, `npm run windows:preflight`, and `npm run windows:test`.** Confirm the model's byte count and SHA-256 exactly match Global Constraints.

## Task 2: Implement and Test Gesture Classification

**Files:**
- Create: `src/gesture/hand-gesture.ts`, `tests/windows-gesture.test.ts`

**Interfaces:**
- `export type HandPose = 'open' | 'fist' | 'neutral' | 'lost'`.
- `export type GestureBlend = 0 | 1`.
- `export function classifyHand(landmarks: readonly Landmark[], confidence: number): HandPose` maps MediaPipe's 21 normalized landmarks into a pose; low confidence returns `neutral`.
- `export class GestureSmoother { update(pose: HandPose, confidence: number, nowMs: number): GestureBlend | undefined; reset(): void }` returns `1` for a stable open palm, `0` for a stable fist, and `undefined` while the current target should be retained.

- [ ] **Step 1: Add landmark fixtures and failing tests.** Cover a front-facing open palm, a fist, a neutral bent hand, low confidence, landmark loss, and mirrored image coordinates. Assert classification only; do not test the MediaPipe implementation through a mock.
- [ ] **Step 2: Add failing smoother tests.** Verify that a pose below 0.75 confidence, a neutral pose, or less than 250 ms of stable evidence never changes the target; verify that stable open palm/fist changes it once after 250 ms and that `lost` preserves the prior target.
- [ ] **Step 3: Run `npx tsx --test tests/windows-gesture.test.ts` and confirm failures are expected missing-export/assertion failures.**
- [ ] **Step 4: Implement `classifyHand` using normalized landmark distances relative to palm size, not screen-pixel constants.** Classify all four fingers and the thumb, avoiding left/right assumptions so mirrored webcam input behaves consistently.
- [ ] **Step 5: Implement `GestureSmoother` with the 0.75 confidence threshold and 250 ms hold.** Keep the target binary; Three.js owns visual interpolation.
- [ ] **Step 6: Re-run the gesture tests and `npm run windows:test`; all new and existing tests must pass.**

## Task 3: Add Explicit Camera and Worker Lifecycle

**Files:**
- Create: `src/gesture/hand-landmarker.worker.ts`, `src/gesture/gesture-camera.ts`, `tests/windows-gesture-camera.test.ts`
- Modify: `src/windows-main.ts`, `src/windows.css`, `tsconfig.windows.json`, `electron/main.ts` only if Electron denies the trusted renderer's video permission

**Interfaces:**
- `export type GestureModeStatus = 'off' | 'requesting' | 'tracking' | 'error'`.
- `GestureCamera.start(onPose: (pose: HandPose, confidence: number, nowMs: number) => void): Promise<void>` requests exactly `{ audio: false, video: { width: 640, height: 480 } }`, starts the worker, and publishes only classified pose data.
- `GestureCamera.stop(): void` stops every `MediaStreamTrack`, closes transferred `ImageBitmap`s, terminates the worker, clears video `srcObject`, and becomes idempotent.
- `new GestureCamera({ mediaDevices, createVideoElement, createWorker, onStatus })` injects browser resources so lifecycle tests never access a real camera.
- Main-to-worker messages are `{ type: 'frame'; frame: ImageBitmap; timestamp: number }` and `{ type: 'dispose' }`; worker-to-main messages are `{ type: 'pose'; pose: HandPose; confidence: number; timestamp: number }` and `{ type: 'error'; message: string }`. The worker closes each received bitmap in `finally` after inference.

- [ ] **Step 1: Write camera lifecycle tests first.** Inject `MediaDevices`, `Worker`, and video-element factories. Test permission granted, permission denied, ended video track, repeated start, repeated stop, and `beforeunload`; assert every granted track stops exactly once and no preview node becomes visible.
- [ ] **Step 2: Run the focused test and confirm it fails because `GestureCamera` is missing.**
- [ ] **Step 3: Implement the worker with `FilesetResolver.forVisionTasks` and `HandLandmarker.createFromOptions`, loading WASM from `./mediapipe/wasm/` and the model from `./models/hand_landmarker.task`.** Create it with `new Worker(new URL('./hand-landmarker.worker.ts', import.meta.url), { type: 'module' })`. Run video detection at no more than 15 Hz; classify in the worker and transfer only pose messages back.
- [ ] **Step 4: Implement `GestureCamera` with a muted, inline, non-rendered video element and `getUserMedia` from the explicit toggle click.** Set `video: { width: 640, height: 480 }`, `audio: false`; call `video.play()` after attaching the stream. Use an idempotent stop path for disable, permission failure after partial startup, track `ended`, and window unload.
- [ ] **Step 5: Add a camera icon toggle and a small always-visible state indicator.** Keep mode disabled at startup. Do not add a camera preview or save frame/landmark data. On disable, stop capture before animating to the assembled state.
- [ ] **Step 6: Keep intermediate/uncertain poses and tracking loss from altering the current target.** Permission errors must show a retry action and leave all voice/text features active.
- [ ] **Step 7: Run `npm run windows:test` and `npm run windows:build`; confirm the worker bundle, `dist-windows/mediapipe/wasm/vision_wasm_internal.wasm`, and `dist-windows/models/hand_landmarker.task` exist.**

## Task 4: Split the Full-Body Model and Animate Its Regions

**Files:**
- Create: `src/helmet/helmet-geometry.ts`, `src/helmet/helmet-scene.ts`, `tests/windows-helmet.test.ts`
- Modify: `src/windows-main.ts`, `src/windows.css`, `scripts/check-desktop-visuals.cjs`

**Interfaces:**
- `export interface ArmorPart { name: string; mesh: THREE.Mesh; assembledPosition: THREE.Vector3; assembledQuaternion: THREE.Quaternion; scatteredPosition: THREE.Vector3; scatteredQuaternion: THREE.Quaternion }`.
- `export function createArmorParts(model: THREE.Object3D, seed: number): ArmorPart[]` returns one independently movable mesh per present named body region, preserving source vertex attribute sizes and material assignment.
- `export class HelmetScene { setDispersal(value: number): void; wake(): void; resize(width: number, height: number, pixelRatio: number): void; dispose(): void }` owns all renderer resources and clamps `value` to `[0, 1]`.

- [ ] **Step 1: Add geometry contract tests.** Assert named body regions, complete triangle retention, UV/color/tangent attribute sizes, finite positions, deterministic scatter targets, and exact assembled transforms.
- [ ] **Step 2: Run `npx tsx --test tests/windows-helmet.test.ts` and confirm tests fail because the module is missing.**
- [ ] **Step 3: Load the full-body GLB and split every triangle into a named region based on normalized height and horizontal position.** Preserve UVs, normals, tangents, material groups, and source textures; transform geometry to a shared model-centered coordinate system.
- [ ] **Step 4: Create one movable mesh per present body region.** Store exact assembled transforms and deterministic bounded outward positions/rotations; the dispersed pose should surround the full figure without leaving the visible desktop region.
- [ ] **Step 5: Implement `HelmetScene` with transparent WebGL clear color, pixel-ratio cap 1.5, resize handling, eased interpolation between each fragment's two transforms, a restrained idle hover, and a disposal path for geometry/material/renderer resources.** Pause the animation loop when the scene is stable.
- [ ] **Step 6: Integrate the scene into the full-monitor transparent shell.** Keep the existing `#jarvis-character` visible behind the WebGL canvas until renderer initialization succeeds; hide it only after the first nonblank Three.js frame. On WebGL or helmet-geometry initialization failure, retain the 2D helmet and disable 3D gestures with a visible error. On MediaPipe or camera failure, keep the 3D helmet assembled, stop capture, and offer retry. Keep controls above the canvas and desktop click-through behavior unchanged.
- [ ] **Step 7: Drive `setDispersal(1)` from stable open palm, `setDispersal(0)` from stable fist, and preserve the last target on neutral/lost.** Voice wake may call `wake()` but must not enable camera capture.
- [ ] **Step 8: Run geometry tests, `npm run windows:test`, and `npm run windows:build`; run `electron scripts/check-desktop-visuals.cjs` and verify WebGL pixels are nonblank.**

## Task 5: Package, Inspect, and Document the Release

**Files:**
- Modify: `electron-builder.yml`, `scripts/check-installed-desktop.mjs`, `scripts/check-packaged-wake.mjs`, `docs/WINDOWS.md`, `outputs/Windows-Jarvis-使用说明.md`, `outputs/Windows-Jarvis-测试记录.md`, `outputs/SHA256SUMS.txt`

- [ ] **Step 1: Add installed-package assertions.** Verify app version `0.3.0`, local model/WASM resources, disabled gesture mode on startup, nonblank transparent WebGL output, and the unchanged click-through/full-monitor bounds.
- [ ] **Step 2: Run `npm run windows:test`, `npm test`, `npm run windows:preflight`, and `npm run windows:build`.** All Windows and original project tests must pass.
- [ ] **Step 3: Capture and inspect 1536x960 and 800x600 production screenshots.** Verify the 3D helmet is correctly framed, transparent around the model, has visible depth and cyan accents, and has no collision with collapsed/expanded controls. Capture assembled, 50% dispersal, and fully dispersed states from deterministic test gestures. Check canvas pixels to reject blank renders.
- [ ] **Step 4: Run `npm run windows:dist` and `electron scripts/check-installed-desktop.mjs` against the installed 0.3.0 package.** Confirm the 3D scene and MediaPipe files are inside the package and ordinary startup does not request camera access.
- [ ] **Step 5: Manually test with the actual camera.** Enable mode, allow/deny access, open palm, fist, briefly leave frame, disable, and close Jarvis. Confirm the state rules, no camera preview, camera-active indicator, and immediate track shutdown.
- [ ] **Step 6: Update user documentation and test records with the actual measured installer size, model hash, test counts, camera acceptance result, and any remaining hardware limitation.** Regenerate the source archive and SHA-256 manifest only after the installer and source contents are final.

## Self-Review

- Spec coverage: explicit opt-in, local/no-preview capture, open/fist mapping, loss hold, off-state cleanup, permission failure, fallback, named full-body regions with source materials preserved, third-party attribution, screenshots, canvas-pixel checks, frame-rate test, and installed-camera acceptance are covered by Tasks 1-5.
- Placeholder scan: no `TODO`, `TBD`, or unspecified runtime download path remains. The model URL, byte count, SHA-256, dependency versions, interfaces, and validation commands are explicit.
- Type consistency: `HandPose` and `GestureSmoother` feed `GestureCamera`; `GestureCamera` emits only pose/confidence/timestamp; `HelmetScene.setDispersal` consumes normalized values. Camera status is independent of assistant voice state.
- Failure-path consistency: WebGL failure uses the existing 2D helmet; MediaPipe/camera failure keeps the 3D helmet assembled and stops capture. Both paths preserve voice/text operation.
