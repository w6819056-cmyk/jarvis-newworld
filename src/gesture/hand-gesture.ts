import type { HeadDirection } from './head-gesture';

export type HandPose = 'open' | 'fist' | 'neutral' | 'lost';
export type GestureBlend = 0 | 1;
export type PointDirection = 'up' | 'down' | 'left' | 'right';
export type GestureHandedness = 'Left' | 'Right';
export interface Landmark { x: number; y: number; z?: number }
export interface GestureHand {
  handedness: GestureHandedness;
  confidence: number;
  pose: HandPose;
  fingerCount: number;
  pointDirection?: PointDirection;
  indexBent: boolean;
  pinching: boolean;
  okGesture?: boolean;
  headDirection?: HeadDirection;
  palmCenter: Landmark;
  pinchCenter: Landmark;
  indexTip?: Landmark;
  landmarks: readonly Landmark[];
}

const CONFIDENCE_THRESHOLD = 0.6;
const HOLD_MS = 250;

function distance(a: Landmark, b: Landmark): number {
  return Math.hypot(a.x - b.x, a.y - b.y, (a.z ?? 0) - (b.z ?? 0));
}

export function classifyHand(landmarks: readonly Landmark[], confidence: number): HandPose {
  if (landmarks.length !== 21 || confidence < CONFIDENCE_THRESHOLD) return 'neutral';
  const wrist = landmarks[0]!;
  const palm = distance(wrist, landmarks[9]!);
  const count = classifyExtendedFingerCount(landmarks, confidence);
  if (count === undefined || !Number.isFinite(palm) || palm < 1e-4) return 'neutral';
  if (count >= 4) return 'open';
  // A closed hand commonly places the thumb over the index finger. The
  // finger count is the reliable signal here; thumb position alone should
  // not turn a fist into a neutral pose.
  if (count === 0) return 'fist';
  return 'neutral';
}

function isExtended(landmarks: readonly Landmark[], wrist: Landmark, palm: number, tipIndex: number, baseIndex: number): boolean {
  const tip = landmarks[tipIndex]!;
  const base = landmarks[baseIndex]!;
  const radial = distance(tip, wrist) > distance(base, wrist) + palm * 0.18;
  if (tipIndex === 4) return radial;
  const pip = landmarks[tipIndex - 2]!;
  const dip = landmarks[tipIndex - 1]!;
  const bend = (a: Landmark, b: Landmark, c: Landmark) => {
    const ab = { x: a.x - b.x, y: a.y - b.y, z: (a.z ?? 0) - (b.z ?? 0) };
    const cb = { x: c.x - b.x, y: c.y - b.y, z: (c.z ?? 0) - (b.z ?? 0) };
    const denominator = Math.hypot(ab.x, ab.y, ab.z) * Math.hypot(cb.x, cb.y, cb.z);
    if (denominator < 1e-5) return 0;
    return Math.acos(Math.max(-1, Math.min(1, (ab.x * cb.x + ab.y * cb.y + ab.z * cb.z) / denominator))) * 180 / Math.PI;
  };
  return radial && bend(base, pip, dip) >= 135 && bend(pip, dip, tip) >= 135;
}

function centerOf(landmarks: readonly Landmark[], indices: readonly number[]): Landmark {
  const sum = indices.reduce((point, index) => ({ x: point.x + landmarks[index]!.x, y: point.y + landmarks[index]!.y }), { x: 0, y: 0 });
  return { x: sum.x / indices.length, y: sum.y / indices.length };
}

export function normalizeMediaPipeHandedness(categoryName: string): GestureHandedness {
  return categoryName.toLowerCase() === 'left' ? 'Left' : 'Right';
}

export function classifyGestureHand(
  categoryName: string,
  confidence: number,
  landmarks: readonly Landmark[],
): GestureHand {
  const valid = landmarks.length === 21;
  const count = classifyExtendedFingerCount(landmarks, confidence) ?? 0;
  const palmCenter = valid ? centerOf(landmarks, [0, 5, 9, 13, 17]) : { x: 0.5, y: 0.5 };
  const pinchCenter = valid ? centerOf(landmarks, [4, 8]) : palmCenter;
  const palmSize = valid ? distance(landmarks[0]!, landmarks[9]!) : 0;
  const thumbExtended = valid && confidence >= CONFIDENCE_THRESHOLD && isExtended(landmarks, landmarks[0]!, palmSize, 4, 2);
  const pinching = valid && confidence >= CONFIDENCE_THRESHOLD && count > 0
    && distance(landmarks[4]!, landmarks[8]!) < palmSize * 0.48;
  return {
    handedness: normalizeMediaPipeHandedness(categoryName),
    confidence,
    pose: classifyHand(landmarks, confidence),
    fingerCount: count,
    pointDirection: count === 1 ? classifyPointDirection(landmarks, confidence) : undefined,
    indexBent: count === 0 && thumbExtended,
    pinching,
    okGesture: pinching && count >= 3,
    palmCenter,
    pinchCenter,
    indexTip: valid ? landmarks[8] : undefined,
    landmarks,
  };
}

/** Apply the recognizer's semantic pose when its classifier is confident. */
export function applyRecognizerPose(hand: GestureHand, gesture: string | undefined, score = 0): void {
  if (score < 0.45) return;
  if (gesture === 'Closed_Fist') hand.pose = 'fist';
  else if (gesture === 'Open_Palm' && hand.fingerCount >= 3) hand.pose = 'open';
}

export function classifyExtendedFingerCount(landmarks: readonly Landmark[], confidence: number): number | undefined {
  if (landmarks.length !== 21 || confidence < CONFIDENCE_THRESHOLD) return undefined;
  const wrist = landmarks[0]!;
  const middleBase = landmarks[9]!;
  const palm = distance(wrist, middleBase);
  if (!Number.isFinite(palm) || palm < 1e-4) return undefined;

  const tips = [8, 12, 16, 20];
  const bases = [5, 9, 13, 17];
  let extended = 0;
  for (let i = 0; i < tips.length; i++) {
    const tipIndex = tips[i]!;
    const tip = landmarks[tipIndex]!;
    const base = landmarks[bases[i]!]!;
    const chain = distance(base, landmarks[tipIndex - 1]!);
    if (distance(tip, wrist) > distance(base, wrist) + palm * 0.28 && distance(tip, base) > chain * 1.15) extended++;
  }
  return extended;
}

export function classifyPointDirection(landmarks: readonly Landmark[], confidence: number): PointDirection | undefined {
  if (landmarks.length !== 21 || confidence < CONFIDENCE_THRESHOLD) return undefined;
  const wrist = landmarks[0]!;
  const palm = distance(wrist, landmarks[9]!);
  const base = landmarks[5]!;
  const tip = landmarks[8]!;
  const dx = tip.x - base.x;
  const dy = tip.y - base.y;
  if (!Number.isFinite(palm) || palm < 1e-4 || Math.hypot(dx, dy) < palm * 0.7) return undefined;
  if (Math.abs(dx) > Math.abs(dy)) return dx < 0 ? 'left' : 'right';
  return dy < 0 ? 'up' : 'down';
}

export class GestureSmoother {
  private candidate: 'open' | 'fist' | undefined;
  private candidateSince = 0;
  private target: GestureBlend | undefined;

  update(pose: HandPose, confidence: number, nowMs: number): GestureBlend | undefined {
    if ((pose !== 'open' && pose !== 'fist') || confidence < CONFIDENCE_THRESHOLD) {
      this.candidate = undefined;
      return undefined;
    }
    if (this.candidate !== pose) {
      this.candidate = pose;
      this.candidateSince = nowMs;
      return undefined;
    }
    if (nowMs - this.candidateSince < HOLD_MS) return undefined;
    const next = pose === 'open' ? 1 : 0;
    if (this.target === next) return undefined;
    this.target = next;
    return next;
  }

  reset(): void {
    this.candidate = undefined;
    this.candidateSince = 0;
    this.target = undefined;
  }
}
