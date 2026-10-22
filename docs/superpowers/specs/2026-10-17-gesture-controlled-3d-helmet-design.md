# Gesture-Controlled 3D Helmet

## Goal

Replace the Windows Jarvis flat helmet presentation with a transparent, desktop-scale Three.js scene showing the supplied full-body Iron Man GLB. Split its merged geometry at runtime into named, independently movable body regions while retaining the source textures and materials. An open palm spreads the regions; a closed fist draws them back into the complete model.

The desktop Jarvis layer stays visible while the assistant waits in the background. The camera image itself is never displayed.

## User Experience

- Gesture mode is off by default and starts only after the user enables its control in Jarvis.
- Enabling the mode requests camera access and starts on-device hand tracking. A visible camera-active indicator remains while the camera is in use.
- The camera feed is processed locally, is not previewed, recorded, persisted, or sent over the network.
- An open palm disperses the helmet. A closed fist assembles it. Intermediate or uncertain poses do not change the current form.
- If the camera temporarily loses the hand, the scene holds its current assembled/dispersed blend until tracking resumes or the user disables gesture mode.
- Disabling gesture mode stops the camera tracks immediately and animates the fragments back into the helmet.
- Permission denial or camera failure leaves the assistant usable and displays a concise status with a way to retry. It does not silently switch on another camera or keep retrying in the background.
- Voice wake, Codex tasks, approvals, and existing desktop controls keep their current behavior.

## Visual Direction

Use the supplied full-body GLB as the visual source. Assign every source triangle to a named anatomical region using its position within model bounds; preserve UVs, normals, tangents, textures, and material assignment. Each region is one independently movable mesh, rather than splitting the model into thousands of disconnected topology islands. Keep the existing centered desktop composition and transparent background. Regions expand around the model's position and return to their exact assembled transforms. The bundled model is by Grant Riley under CC BY-NC 4.0; preserve attribution and license notices.

The scene remains an unframed full-monitor desktop layer. The normal head size, click-through behavior, collapsed controls, and current wake assembly sequence remain intact. WebGL or model initialization failure falls back to the existing 2D helmet so the assistant stays usable.

## Architecture

- Three.js owns the transparent WebGL scene, helmet mesh, fragment transforms, lighting, resize handling, and animation loop.
- A locally bundled MediaPipe Tasks Vision Hand Landmarker reads a single explicitly enabled webcam stream. Its model and applicable license notices ship with the app; runtime does not fetch model files. It produces a normalized gesture state only; raw frames do not leave the renderer or enter application state.
- Gesture classification and state smoothing run independently from scene rendering. Hand inference targets 10-15 samples per second; Three.js renders at the display refresh rate when animated and pauses when stable.
- The UI exposes one gesture-mode toggle and an active/permission/error indicator. No camera preview is shown.
- Camera track lifecycle is explicit: enable -> permission -> start track and tracker; disable -> stop tracks, dispose tracker, and settle the helmet. Window shutdown performs the same cleanup.
- Keep gesture state separate from the existing voice state and do not send gesture data through Codex IPC.

## Gesture State

The visual state is a normalized blend from assembled (0) to dispersed (1). An open-palm classification above 0.75 confidence for 250 ms moves the target toward 1; a fist classification under the same threshold and hold moves it toward 0. Easing prevents abrupt jumps. Neutral poses and low-confidence samples preserve the previous target. The blend is controlled only by pose, not by palm position.

When tracking is lost, retain the last target without an automatic reset. Turning gesture mode off always restores the assembled state. The current audio wake animation remains a separate event and may play normally without activating the camera.

## Privacy and Failure Handling

- Gesture mode is explicitly opt-in each time the app starts; camera access is never requested during ordinary voice listening.
- The renderer requests video only and does not request a second audio stream.
- The camera-active indicator is visible even when the controls are collapsed.
- Permission denial, missing camera, ended tracks, and unavailable WebGL are reported without crashing or blocking text/voice operation.
- No frame, landmark, or gesture history is written to disk or sent to the Codex runtime.

## Validation

- Unit tests cover open-palm/fist/uncertain classification, confidence hysteresis, tracking loss, mode enable/disable, and camera cleanup.
- Renderer tests feed deterministic gesture states and verify exact assembled/dispersed endpoints and smooth intermediate motion.
- Capture desktop screenshots at 1536x960 and 800x600; verify nonblank transparent WebGL output, correct framing, camera indicator, and no overlap with controls. Inspect the WebGL canvas pixels as well as DOM state.
- Measure the animated scene under the target Windows desktop setup and check that camera inference does not stall rendering. Record WebGL fallback behavior.
- Manual acceptance uses the actual camera: enable/disable, open hand, fist, brief tracking loss, permission denial, and Jarvis shutdown. Confirm that no camera preview appears and that the camera turns off when the mode is disabled.

## Out of Scope

- Remote vision services, cloud upload, recording, or gesture-based computer actions.
- Using hand position to drag or reposition the desktop helmet.
- Replacing the voice wake pipeline or changing the existing Codex permission behavior.
- Adding gesture-based computer actions beyond model assembly and dispersion.
