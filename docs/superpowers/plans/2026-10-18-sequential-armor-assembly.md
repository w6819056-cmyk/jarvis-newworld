# Sequential Armor Assembly Implementation Plan

**Goal:** Restore dispersed armor in a visible sequence, synthesize local completion cues, and rotate the armor slowly while it assembles.

**Architecture:** `assembly-sequence.ts` defines deterministic part/group steps and the damped spin state. `HelmetScene` interpolates transforms and emits completion events. `AssemblyAudio` generates the two sound tiers locally through Web Audio.

## Completed

- [x] Add deterministic fragment and group sequences with chest-first large-group ordering.
- [x] Add local short and bright assembly cues with silent fallback when audio is unavailable.
- [x] Interpolate armor parts and groups through the sequence and fire one cue per completed step.
- [x] Ramp assembly rotation up smoothly and damp it after completion or cancellation.
- [x] Route fist reset gestures to sequential restore while keeping inspection exit and mode changes immediate.
- [x] Verify the rotation helper, 94 Windows tests, 8 project tests, Windows build, and Electron desktop visual check.
- [x] Package a fresh Windows installer in `release/windows-new21` and verify its bundled renderer contains the assembly code.
- [x] Add the inspection entry sequence: seven major groups fly in from off-screen with white energy-spray particles before locking into the model.
- [x] Verify the inspection entry sequence and particle renderer through the Electron desktop visual check.
