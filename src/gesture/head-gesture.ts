import type { Landmark } from './hand-gesture';

export type HeadDirection = 'up' | 'down' | 'left' | 'right';

export interface HeadDirectionSmootherOptions {
  holdMs?: number;
  releaseMs?: number;
}

/** Classifies deliberate head turns from the stable face landmarks. */
export function classifyHeadDirection(landmarks: readonly Landmark[], mirroredInput = false): HeadDirection | undefined {
  if (landmarks.length < 264) return undefined;
  const nose = landmarks[1]!;
  const forehead = landmarks[10]!;
  const chin = landmarks[152]!;
  const leftEye = landmarks[33]!;
  const rightEye = landmarks[263]!;
  const eyeCenter = { x: (leftEye.x + rightEye.x) / 2, y: (leftEye.y + rightEye.y) / 2 };
  const eyeDistance = Math.hypot(rightEye.x - leftEye.x, rightEye.y - leftEye.y);
  const faceHeight = Math.abs(chin.y - forehead.y);
  if (eyeDistance < 0.04 || faceHeight < 0.08) return undefined;

  const yaw = (nose.x - eyeCenter.x) / eyeDistance;
  const pitch = (nose.y - eyeCenter.y) / faceHeight;
  // Keep a broad neutral band around the resting pose. Face landmarks move by
  // a few pixels even when the user is still, and that noise must not select a
  // component in mode 3.
  const verticalDistance = pitch < 0.12 ? 0.12 - pitch : pitch > 0.30 ? pitch - 0.30 : 0;
  const horizontalDistance = Math.abs(yaw) > 0.18 ? Math.abs(yaw) - 0.18 : 0;
  if (verticalDistance <= 0 && horizontalDistance <= 0) return undefined;
  if (verticalDistance > horizontalDistance) return pitch < 0.12 ? 'up' : 'down';
  if (horizontalDistance <= 0) return undefined;
  const visualYaw = mirroredInput ? yaw : -yaw;
  return visualYaw < 0 ? 'left' : 'right';
}

/**
 * Converts noisy frame-level directions into deliberate direction events.
 * A direction change is gated by a neutral interval so a single landmark jump
 * cannot move the selection from one armor component to its opposite.
 */
export class HeadDirectionSmoother {
  private readonly holdMs: number;
  private readonly releaseMs: number;
  private stable: HeadDirection | undefined;
  private candidate: HeadDirection | undefined;
  private candidateSince = 0;
  private neutralSince: number | undefined;

  constructor(options: HeadDirectionSmootherOptions = {}) {
    this.holdMs = options.holdMs ?? 120;
    this.releaseMs = options.releaseMs ?? 180;
  }

  update(direction: HeadDirection | undefined, nowMs: number): HeadDirection | undefined {
    if (direction === undefined) {
      this.candidate = undefined;
      if (this.stable === undefined) return undefined;
      this.neutralSince ??= nowMs;
      if (nowMs - this.neutralSince >= this.releaseMs) {
        this.stable = undefined;
        this.neutralSince = undefined;
        return undefined;
      }
      return this.stable;
    }

    this.neutralSince = undefined;
    if (this.stable !== undefined) {
      if (direction === this.stable) return this.stable;
      // Require the face to return to neutral before accepting another side.
      this.candidate = undefined;
      return this.stable;
    }

    if (this.candidate !== direction) {
      this.candidate = direction;
      this.candidateSince = nowMs;
      if (this.holdMs <= 0) {
        this.stable = direction;
        this.candidate = undefined;
        return this.stable;
      }
      return undefined;
    }
    if (nowMs - this.candidateSince < this.holdMs) return undefined;
    this.stable = direction;
    this.candidate = undefined;
    return this.stable;
  }

  reset(): void {
    this.stable = undefined;
    this.candidate = undefined;
    this.candidateSince = 0;
    this.neutralSince = undefined;
  }
}
