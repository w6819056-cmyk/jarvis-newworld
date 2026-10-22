# Head Direction Stability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce false head-direction selections in armor mode 3.

**Architecture:** Keep the existing MediaPipe face worker and geometric classifier. Add a small stateful smoother between raw classification and the callback, using a hold window, neutral release window, and neutral-gated direction changes.

**Tech Stack:** TypeScript, MediaPipe Tasks Vision, Node test runner.

## Global Constraints

- Keep the existing GPU face-landmarker pipeline.
- Do not change armor modes, handedness, or model movement behavior.
- Preserve the public `classifyHeadDirection` return type.

### Task 1: Add classifier and smoother tests

**Files:**
- Modify: `tests/windows-head-gesture.test.ts`

- [ ] Add tests for centered landmark noise, candidate hold, brief gap retention, sustained neutral release, and neutral-gated direction changes.
- [ ] Run `npx tsx --test tests/windows-head-gesture.test.ts` and confirm the new smoother tests fail before implementation.

### Task 2: Implement head direction smoothing

**Files:**
- Modify: `src/gesture/head-gesture.ts`

- [ ] Add explicit neutral bands to the stateless classifier without changing its moderate-direction behavior.
- [ ] Add `HeadDirectionSmoother` with hold and release windows and neutral-gated direction changes.
- [ ] Run the focused head gesture tests and confirm they pass.

### Task 3: Apply smoothing in the face worker

**Files:**
- Modify: `src/gesture/face-landmarker.worker.ts`

- [ ] Keep one smoother per worker and feed each classified frame through it before posting the head event.
- [ ] Reset the smoother on initialization and disposal.
- [ ] Run the full Windows test suite and TypeScript check.
