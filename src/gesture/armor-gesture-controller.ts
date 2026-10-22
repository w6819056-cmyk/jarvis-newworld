import type { GestureHand, Landmark, PointDirection } from './hand-gesture';
import type { HeadDirection } from './head-gesture';
export type { GestureHand } from './hand-gesture';

export type ArmorMode = 1 | 2 | 3;
export type ArmorGestureAction =
  | { type: 'mode-change'; mode: ArmorMode; resetAll: true; announcement: string }
  | { type: 'disperse'; scope: 'fragments' | 'groups' | 'selected'; value: boolean }
  | { type: 'rotate'; deltaX: number }
  | { type: 'face-forward' }
  | { type: 'select-direction'; direction: PointDirection }
  | { type: 'confirm-selection' }
  | { type: 'drag-start' | 'drag-move'; point: Landmark }
  | { type: 'drag-end' }
  | { type: 'reset-all' };

const CONFIDENCE_THRESHOLD = 0.6;
const MODE_HOLD_MS = 500;
const POSE_HOLD_MS = 140;
const DIRECTION_HOLD_MS = 180;
const CONFIRM_HOLD_MS = 180;
const DIRECTION_RELEASE_MS = 160;
const PINCH_HOLD_MS = 120;
const TWO_HAND_RESET_HOLD_MS = 500;
const HANDS_TOGETHER_DISTANCE = 0.14;

function distance(a: Landmark, b: Landmark): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export class ArmorGestureController {
  mode: ArmorMode = 1;
  private modeCandidate: ArmorMode | undefined;
  private modeCandidateSince = 0;
  private modePose = 0;
  private rightPose: 'open' | 'fist' | undefined;
  private rightPoseSince = 0;
  private appliedRightPose: 'open' | 'fist' | undefined;
  private leftX: number | undefined;
  private leftFistSince: number | undefined;
  private leftFistApplied = false;
  private leftOkSince: number | undefined;
  private leftOkApplied = false;
  private directionCandidate: PointDirection | undefined;
  private directionSince = 0;
  private appliedDirection: PointDirection | undefined;
  private headDirectionCandidate: HeadDirection | undefined;
  private headDirectionSince = 0;
  private appliedHeadDirection: HeadDirection | undefined;
  private bendSince: number | undefined;
  private bendApplied = false;
  private pinchSince: number | undefined;
  private dragging = false;
  private togetherSince: number | undefined;
  private togetherApplied = false;

  update(hands: readonly GestureHand[], nowMs: number, headDirection?: HeadDirection): ArmorGestureAction[] {
    const left = hands.find(hand => hand.handedness === 'Left' && hand.confidence >= CONFIDENCE_THRESHOLD);
    const right = hands.find(hand => hand.handedness === 'Right' && hand.confidence >= CONFIDENCE_THRESHOLD);

    if (left && right && distance(left.palmCenter, right.palmCenter) < HANDS_TOGETHER_DISTANCE) {
      this.togetherSince ??= nowMs;
      if (!this.togetherApplied && nowMs - this.togetherSince >= TWO_HAND_RESET_HOLD_MS) {
        this.togetherApplied = true;
        this.clearManipulationState();
        this.modeCandidate = undefined;
        this.modePose = 0;
        return [{ type: 'reset-all' }];
      }
      return [];
    }
    this.togetherSince = undefined;
    this.togetherApplied = false;

    if (!left?.okGesture) {
      this.leftOkSince = undefined;
      this.leftOkApplied = false;
    }

    // A closed fist can briefly be counted as one raised finger by the
    // landmark classifier. Its explicit fist pose must win over mode select.
    const selectedMode = left && !left.okGesture && left.pose !== 'fist' && left.fingerCount >= 1 && left.fingerCount <= 3
      ? left.fingerCount as ArmorMode
      : undefined;
    if (selectedMode !== this.modePose) {
      this.modePose = selectedMode ?? 0;
      this.modeCandidate = selectedMode;
      this.modeCandidateSince = nowMs;
    } else if (selectedMode !== undefined && this.modeCandidate === selectedMode && nowMs - this.modeCandidateSince >= MODE_HOLD_MS) {
      this.modeCandidate = undefined;
      this.mode = selectedMode;
      this.clearManipulationState();
      return [{ type: 'mode-change', mode: selectedMode, resetAll: true, announcement: `切换至模式 ${selectedMode}` }];
    }
    if (selectedMode !== undefined) return [];

    const actions: ArmorGestureAction[] = [];
    if (left?.okGesture) {
      this.leftOkSince ??= nowMs;
      if (!this.leftOkApplied && nowMs - this.leftOkSince >= CONFIRM_HOLD_MS) {
        this.leftOkApplied = true;
        actions.push({ type: 'face-forward' });
      }
      return actions;
    }

    const leftFist = left?.pose === 'fist' || left?.fingerCount === 0;
    if (leftFist) {
      this.leftFistSince ??= nowMs;
      if (!this.leftFistApplied && nowMs - this.leftFistSince >= POSE_HOLD_MS) {
        this.leftFistApplied = true;
        actions.push({ type: 'face-forward' });
      }
      return actions;
    } else {
      this.leftFistSince = undefined;
      this.leftFistApplied = false;
    }
    if (this.mode === 3) {
      if (headDirection !== this.headDirectionCandidate) {
        this.headDirectionCandidate = headDirection;
        this.headDirectionSince = nowMs;
      } else if (!headDirection && this.appliedHeadDirection && nowMs - this.headDirectionSince >= DIRECTION_RELEASE_MS) {
        this.appliedHeadDirection = undefined;
      } else if (headDirection && headDirection !== this.appliedHeadDirection && nowMs - this.headDirectionSince >= DIRECTION_HOLD_MS) {
        this.appliedHeadDirection = headDirection;
        actions.push({ type: 'select-direction', direction: headDirection });
      }
    }
    const canRotate = left?.pose === 'open'
      && left.fingerCount >= 3
      && !left.pinching;
    if (canRotate) {
      if (this.leftX !== undefined) {
        const deltaX = left.palmCenter.x - this.leftX;
        // Camera X grows to the right, while the armor's visible yaw grows in
        // the opposite direction. Keep the gesture in the user's visual frame.
        if (Math.abs(deltaX) >= 0.008) actions.push({ type: 'rotate', deltaX: -deltaX });
      }
      this.leftX = left.palmCenter.x;
    } else this.leftX = undefined;

    if (this.mode === 3) {
      this.updateRightIndexDrag(right, nowMs, actions);
      this.updateModeThreeRightHand(right, nowMs, actions);
      return actions;
    }

    const rightActionable = right && (right.pose === 'open' || right.pose === 'fist' || right.fingerCount === 0 || right.pinching || right.fingerCount === 1);
    const controlHand = rightActionable ? right : undefined;
    if (controlHand) this.updateRightHand(controlHand, nowMs, actions);
    else this.resetRightHand(actions);
    return actions;
  }

  reset(mode: ArmorMode = 1): void {
    this.mode = mode;
    this.modeCandidate = undefined;
    this.modePose = 0;
    this.clearManipulationState();
    this.togetherSince = undefined;
    this.togetherApplied = false;
  }

  private updateRightHand(hand: GestureHand, nowMs: number, actions: ArmorGestureAction[]): void {
    const scope = this.mode === 1 ? 'fragments' : 'groups';
    const closed = hand.pose === 'fist' || hand.fingerCount === 0;
    const nextPose = closed ? 'fist' : hand.pose === 'open' && !hand.pinching ? 'open' : undefined;
    if (nextPose !== this.rightPose) {
      this.rightPose = nextPose;
      this.rightPoseSince = nowMs;
    } else if (nextPose && nextPose !== this.appliedRightPose && nowMs - this.rightPoseSince >= POSE_HOLD_MS) {
      this.appliedRightPose = nextPose;
      actions.push({ type: 'disperse', scope, value: nextPose === 'open' });
    }

  }

  private updateRightIndexDrag(hand: GestureHand | undefined, nowMs: number, actions: ArmorGestureAction[]): void {
    const isIndex = hand && hand.fingerCount === 1 && hand.pointDirection !== undefined && hand.pose !== 'fist' && !hand.okGesture;
    const point = hand?.indexTip ?? hand?.palmCenter;
    if (isIndex && point) {
      this.pinchSince ??= nowMs;
      if (!this.dragging && nowMs - this.pinchSince >= PINCH_HOLD_MS) {
        this.dragging = true;
        actions.push({ type: 'drag-start', point });
      } else if (this.dragging) actions.push({ type: 'drag-move', point });
    } else {
      this.pinchSince = undefined;
      if (this.dragging) {
        this.dragging = false;
        actions.push({ type: 'drag-end' });
      }
    }
  }

  private updateModeThreeRightHand(hand: GestureHand | undefined, nowMs: number, actions: ArmorGestureAction[]): void {
    const isFist = hand && (hand.pose === 'fist' || hand.fingerCount === 0);
    if (isFist) {
      if (this.rightPose !== 'fist') {
        this.rightPose = 'fist';
        this.rightPoseSince = nowMs;
      } else if (this.appliedRightPose !== 'fist' && nowMs - this.rightPoseSince >= POSE_HOLD_MS) {
        this.appliedRightPose = 'fist';
        this.dragging = false;
        this.pinchSince = undefined;
        this.bendSince = undefined;
        this.bendApplied = false;
        actions.push({ type: 'reset-all' });
      }
    } else {
      this.rightPose = undefined;
      this.rightPoseSince = 0;
      this.appliedRightPose = undefined;
    }

    if (hand?.okGesture) {
      this.bendSince ??= nowMs;
      if (!this.bendApplied && nowMs - this.bendSince >= CONFIRM_HOLD_MS) {
        this.bendApplied = true;
        actions.push({ type: 'confirm-selection' });
      }
    } else {
      this.bendSince = undefined;
      this.bendApplied = false;
    }

  }

  private resetRightHand(actions: ArmorGestureAction[]): void {
    this.rightPose = undefined;
    this.appliedRightPose = undefined;
    this.directionCandidate = undefined;
    this.appliedDirection = undefined;
    this.bendSince = undefined;
    this.bendApplied = false;
    this.pinchSince = undefined;
    if (this.dragging) {
      this.dragging = false;
      actions.push({ type: 'drag-end' });
    }
  }

  private clearManipulationState(): void {
    this.rightPose = undefined;
    this.rightPoseSince = 0;
    this.appliedRightPose = undefined;
    this.leftX = undefined;
    this.leftFistSince = undefined;
    this.leftFistApplied = false;
    this.leftOkSince = undefined;
    this.leftOkApplied = false;
    this.directionCandidate = undefined;
    this.directionSince = 0;
    this.appliedDirection = undefined;
    this.headDirectionCandidate = undefined;
    this.headDirectionSince = 0;
    this.appliedHeadDirection = undefined;
    this.bendSince = undefined;
    this.bendApplied = false;
    this.pinchSince = undefined;
    this.dragging = false;
  }
}
