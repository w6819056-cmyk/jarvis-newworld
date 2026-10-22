# Three-Mode Armor Gestures Implementation Plan

> **For agentic workers:** Use inline execution with test-first steps and verify every task before continuing.

**Goal:** Add three hand-controlled armor modes with deterministic mode switching, seven selectable body groups, direct manipulation, and visible selection feedback.

**Architecture:** The MediaPipe worker reports both hands, handedness, confidence, and landmarks. A pure gesture state machine converts those frames into mode and manipulation actions; the renderer applies them to a Three.js scene that retains 47 source meshes beneath seven body-group parents. Mode 1 animates individual meshes, mode 2 animates the seven groups in a tidy layout, and mode 3 selects, moves, rotates, and internally disperses one group at a time.

**Tech Stack:** TypeScript, MediaPipe Tasks Vision, Three.js 0.186, Electron, Node test runner through `tsx`.

## Global Constraints

- Inspection remains local and camera capture remains video-only.
- Mode selection uses the left hand; right-hand actions operate the armor; left-hand horizontal motion rotates it.
- Every accepted mode change first restores all meshes and groups, then updates the active mode and speaks `切换至模式 N`.
- Mode 1 disperses the 47 source meshes; mode 2 disperses seven stable body groups; mode 3 manipulates a selected group and its source meshes.
- Two hands brought together restore the complete assembled armor from any mode.
- Lost or uncertain tracking preserves the last transforms and selection.
- Preserve the source model's meshes, geometry attributes, materials, and normalized assembled transforms.

## File Map

- `src/gesture/hand-gesture.ts`: classify finger counts and hand poses from MediaPipe landmarks, retaining confidence filtering and temporal stability.
- `src/gesture/hand-landmarker.worker.ts`: detect up to two hands and send handedness, confidence, landmarks, and timestamp.
- `src/gesture/gesture-camera.ts`: type and forward multi-hand frames without changing camera lifecycle guarantees.
- `src/gesture/armor-gesture-controller.ts`: translate stable hand frames into mode, scatter, rotate, select, confirm, drag, and reset actions.
- `src/helmet/helmet-geometry.ts`: preserve each source mesh and assign it to one of seven body groups; compute deterministic fragment and tidy group scatter targets.
- `src/helmet/helmet-scene.ts`: animate fragment/group modes, selection navigation, drag transforms, part rotation, reset, and selected-part outline.
- `src/windows-main.ts`, `windows.html`, `src/windows.css`: route gesture actions, announce mode changes, and show current mode/selected part.
- `tests/windows-gesture.test.ts`, new `tests/windows-armor-gesture-controller.test.ts`, `tests/windows-helmet.test.ts`, `scripts/check-desktop-visuals.cjs`: cover pure recognition, transitions, transforms, and packaged visual behavior.

## Task 1: Report Two-Hand Landmark Frames

- [x] Add tests for classifying one-, two-, and three-finger poses, index pointing directions, index bend, pinch, and open/fist poses.
- [x] Run `npm run windows:test`; confirm the new classifier cases fail because the current API only returns `open`, `fist`, `neutral`, or `lost`.
- [x] Change the worker payload to `{ type: 'frame', hands: [{ handedness, confidence, landmarks, pose }], timestamp }` and configure MediaPipe with `numHands: 2`.
- [x] Change the camera callback to receive the complete hand-frame array; keep video-only permission, stopped-track cleanup, worker error handling, and tracking-loss behavior intact.
- [x] Run the focused gesture and camera tests, then the full Windows test suite.

## Task 2: Add the Gesture State Machine

- [x] Add controller tests for left-hand 1/2/3 mode selection, stable-pose debounce, and mode-change action ordering: assemble all, switch mode, announce mode.
- [x] Add controller tests for mode 1/2 right-hand open/fist behavior, left-hand horizontal rotation, mode 3 directional selection/confirm/pinch drag/local open/fist, and two-hand reset.
- [x] Run `npm run windows:test`; confirm the controller tests fail because the controller module does not exist.
- [x] Implement a pure `ArmorGestureController.update(frame, nowMs)` that emits typed actions; ignore uncertain input, latch selected mode, and avoid firing repeated actions while a pose is held.
- [x] Run the focused controller tests and all Windows tests.

## Task 3: Build Seven Named Body Groups

- [x] Extend `tests/windows-helmet.test.ts` to assert exactly seven names (`head`, `chest`, `abdomen`, `left-arm`, `right-arm`, `left-leg`, `right-leg`), complete source-mesh coverage, unchanged triangle count, and deterministic tidy group destinations.
- [x] Run the focused helmet tests and confirm the new group assertions fail with the current 47-independent-mesh-only structure.
- [x] Add group assignment to `createArmorParts`; keep pelvis within abdomen, preserve source mesh local transforms/materials, and provide stable assembled and spread transforms for both 47-mesh and 7-group modes.
- [x] Run the focused helmet tests and full Windows suite.

## Task 4: Add Scene Manipulation and Selection Feedback

- [x] Add tests for mode changes restoring all groups, directional navigation choosing the nearest group in that screen direction, selected-group drag preserving child transforms, selected-part-only scatter, fist reassembly, and global reset.
- [x] Run the focused tests and confirm missing scene/controller behavior fails clearly before implementation.
- [x] Add `HelmetScene` APIs for mode, fragment/group dispersal, directional selection, confirmation, drag, selected-group rotation, and full reset.
- [x] Add a cyan silhouette outline around the selected group and expose the selected group name through scene state for the renderer; clear selection only on full reset or inspection exit.
- [x] Run `npm run windows:test` and `npm run windows:build`.

## Task 5: Wire Voice, Status, and Desktop Validation

- [x] Extend the Electron visual check to assert mode labels, mode-3 selected name/highlight, seven group names, all 47 source meshes, and reset on mode-switch gestures; two-hand reset is covered by controller tests.
- [x] Run the visual check and confirm the new DOM/scene assertions fail before renderer integration.
- [x] Route controller actions in `src/windows-main.ts`; on each accepted mode action, reset the scene before calling the existing local `speak` function with `切换至模式 N`.
- [x] Show the active mode and selected part name in the existing gesture indicator; keep error, camera-off, and inspection-exit states accurate.
- [x] Run `npm run windows:test`, `npm run windows:build`, and `npx electron scripts/check-desktop-visuals.cjs`; inspect generated screenshots for the outline and tidy group spread.

## Self-Review

- Spec coverage: three modes, left-hand mode selection, right-hand gestures, horizontal rotation, directional selection, bend confirmation, pinch dragging, local fragment scatter/reassembly, two-hand reset, speech announcement, tracking-loss preservation, and outline/name feedback map to Tasks 1-5.
- Scope: the existing voice-inspection entry/exit flow and camera lifecycle remain in place; this plan changes only gesture transport, interaction state, armor transforms, and their visible status.
- Placeholder scan: all steps name concrete modules, assertions, and commands; no deferred implementation tasks remain.
- Type consistency: the worker emits arrays of handed `GestureHand` values; the camera forwards that frame; the controller emits typed actions; `HelmetScene` consumes those actions through explicit methods.
