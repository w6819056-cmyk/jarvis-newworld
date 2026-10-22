# Head Direction Stability Design

## Goal

Reduce false head-direction selections in armor mode 3 while preserving the existing MediaPipe GPU pipeline and interaction timing.

## Design

`classifyHeadDirection` remains a stateless geometric classifier, but its neutral bands become explicit and its measurements stay normalized by eye distance and face height. A new `HeadDirectionSmoother` consumes the raw direction in the face worker. A direction must remain present for a short hold before becoming stable; a stable direction is released only after a sustained neutral interval. Direction changes must pass through the neutral state, preventing one noisy frame from changing the selected armor component.

The smoother publishes the last stable direction during brief detection gaps. The existing armor controller remains responsible for its own selection hold and action dispatch, so this change does not alter mode definitions or model movement semantics.

## Acceptance Criteria

- Small landmark noise around a centered face produces no direction.
- A direction is not published until it is stable for the configured hold window.
- A stable direction survives brief undefined frames and is released after the release window.
- A direct jump from one direction to another cannot immediately change selection without a neutral interval.
- Existing moderate up/down/left/right classification tests continue to pass.
- Existing Windows TypeScript and gesture tests pass.
