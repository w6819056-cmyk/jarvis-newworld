# Gesture Recognition Preview Design

## Goal

Make the existing camera-based gesture recognizer observable so the user can compare their physical pose with the points and labels produced by the application.

## User experience

- While gesture mode is active, show a compact, collapsible camera preview in the upper-right corner.
- Draw the recognized hand landmark points and bone connections over the live preview.
- Show each detected hand's handedness, recognized pose (open palm, fist, OK, or pinch), and finger count.
- Show the current head direction used by mode 3 selection.
- Hide the preview when gesture mode is off; stopping gesture mode continues to stop the camera as it does today.
- Keep the model controls and gesture actions unchanged.

## Data flow

Reuse the existing camera stream and worker results. Expose the active video element and latest landmark/pose results to a preview callback or view owned by `GestureCamera`; do not open a second camera stream. Draw the skeleton in a UI canvas scaled to the preview dimensions. Keep recognition and rendering separate so drawing does not block worker inference.

## Failure behavior

Show a clear waiting or camera-error state when no frames or hands are available. Never retain a stale skeleton after the hand disappears. Hiding the preview must not leave the camera running after gesture mode has stopped.

## Verification

- Unit-test hand pose labels and preview state updates where practical.
- Verify overlay landmarks update and clear on hand loss.
- Run Windows gesture tests, production build, and desktop visual check.
- Confirm the preview is absent when gesture mode is off and visible while tracking.
