# Sequential Armor Assembly Design

## Goal

When a restore gesture is recognized, make dispersed armor parts assemble in an ordered sequence with a distinct local sound for small and large components, while the armor slowly rotates during assembly.

## Behavior

- Mode 1 moves fragments from the sphere to seven separated body-group stations, one fragment at a time. After every fragment has joined its body group, move the seven assembled groups back to their positions in the full armor, one group at a time.
- Modes 2 and 3 move body groups back to the full-armor layout one at a time.
- Play a short crisp synthesized sound when a small fragment joins and a brighter, fuller synthesized sound when a large group joins. Synthesis runs locally through Web Audio and uses no downloaded media.
- Slowly rotate the full armor while an assembly sequence runs. Ramp angular velocity down smoothly when the sequence ends or is cancelled.
- When entering armor inspection, fly the seven major groups in from off-screen on staggered paths with a short white energy-spray trail, then lock them into the assembled model.
- A new mode, immediate reset, or new dispersal cancels the active assembly sequence and clears its queued sound events.
- Keep the existing ease-in/out transform animation and gesture mappings.

## Architecture

Create a pure assembly-sequence module that produces deterministic steps from the current mode and group/part names. The helmet scene owns transform interpolation, cancellation, completion events, and assembly rotation. A small Web Audio service synthesizes the two sound tiers; the renderer wires it to scene completion events.

## Validation

- Unit tests verify mode-specific order, phase boundaries, duration, and cancellation-safe event ordering.
- Scene verification checks that mode 1 parts finish at their group stations before the large-group phase and that modes 2/3 restore groups in order.
- Audio tests use an injected AudioContext-compatible fake to verify small and large sound envelopes without requiring speakers.
- Run Windows tests, project tests, Windows build, and the desktop visual check.
