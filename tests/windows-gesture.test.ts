import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyExtendedFingerCount, classifyGestureHand, classifyHand, classifyPointDirection, normalizeMediaPipeHandedness, applyRecognizerPose, GestureSmoother, type Landmark } from '../src/gesture/hand-gesture.ts';

const openHand: Landmark[] = [
  [0.5, 0.9], [0.5, 0.72], [0.5, 0.58], [0.5, 0.44], [0.5, 0.3],
  [0.4, 0.62], [0.39, 0.48], [0.38, 0.34], [0.37, 0.2],
  [0.46, 0.6], [0.46, 0.43], [0.46, 0.27], [0.46, 0.12],
  [0.54, 0.6], [0.54, 0.43], [0.54, 0.27], [0.54, 0.12],
  [0.62, 0.62], [0.63, 0.48], [0.64, 0.34], [0.65, 0.2],
].map(([x, y]) => ({ x, y }));

const fist: Landmark[] = openHand.map((point, index) => {
  if (index === 0) return point;
  const wrist = openHand[0]!;
  const finger = Math.floor((index - 1) / 4);
  const base = openHand[1 + finger * 4]!;
  return { x: base.x + (wrist.x - base.x) * 0.15, y: base.y + (wrist.y - base.y) * 0.12 };
});

test('classifies open palm and fist independent of mirrored image coordinates', () => {
  assert.equal(classifyHand(openHand, 0.9), 'open');
  assert.equal(classifyHand(fist, 0.9), 'fist');
  const mirrored = openHand.map(({ x, y }) => ({ x: 1 - x, y }));
  assert.equal(classifyHand(mirrored, 0.9), 'open');
});

test('low confidence, neutral pose, and missing landmarks do not force a gesture', () => {
  assert.equal(classifyHand(openHand, 0.62), 'open');
  assert.equal(classifyHand(openHand, 0.5), 'neutral');
  assert.equal(classifyHand(openHand.slice(0, 10), 0.9), 'neutral');
  const smoother = new GestureSmoother();
  assert.equal(smoother.update('neutral', 0.9, 0), undefined);
  assert.equal(smoother.update('lost', 0, 100), undefined);
});

test('does not count a finger whose tip folds back toward the palm', () => {
  const bentIndex = openHand.map(point => ({ ...point }));
  bentIndex[6] = { x: 0.5, y: 0.43 };
  bentIndex[7] = { x: 0.57, y: 0.47 };
  bentIndex[8] = { x: 0.6, y: 0.56 };
  assert.equal(classifyExtendedFingerCount(bentIndex, 0.9), 3);
});

test('keeps a thumb-over-index fist closed and accepts a relaxed pinch', () => {
  const thumbOverIndex = fist.map(point => ({ ...point }));
  thumbOverIndex[4] = { x: 0.57, y: 0.58 };
  assert.equal(classifyHand(thumbOverIndex, 0.9), 'fist');

  const pinch = openHand.map(point => ({ ...point }));
  pinch[4] = { x: 0.49, y: 0.31 };
  pinch[8] = { x: 0.53, y: 0.31 };
  const detected = classifyGestureHand('Left', 0.62, pinch);
  assert.equal(detected.pinching, true);
});

test('requires 250 ms of confident stable pose and preserves target on loss', () => {
  const smoother = new GestureSmoother();
  assert.equal(smoother.update('open', 0.8, 0), undefined);
  assert.equal(smoother.update('open', 0.8, 249), undefined);
  assert.equal(smoother.update('open', 0.8, 250), 1);
  assert.equal(smoother.update('lost', 0, 300), undefined);
  assert.equal(smoother.update('fist', 0.9, 400), undefined);
  assert.equal(smoother.update('fist', 0.9, 650), 0);
});

test('counts one, two, and three raised fingers without counting the thumb', () => {
  const withRaised = (...raised: number[]) => openHand.map((point, index) => {
    const finger = index >= 5 ? Math.floor((index - 5) / 4) : undefined;
    return finger !== undefined && !raised.includes(finger) ? fist[index]! : point;
  });
  assert.equal(classifyExtendedFingerCount(withRaised(0), 0.9), 1);
  assert.equal(classifyExtendedFingerCount(withRaised(0, 1), 0.9), 2);
  assert.equal(classifyExtendedFingerCount(withRaised(0, 1, 2), 0.9), 3);
  assert.equal(classifyExtendedFingerCount(fist, 0.9), 0);
  assert.equal(classifyExtendedFingerCount(openHand, 0.9), 4);
  assert.equal(classifyExtendedFingerCount(openHand, 0.2), undefined);
});

test('classifies the pointing direction of the right index finger', () => {
  const pointIn = (tip: Landmark): Landmark[] => {
    const points = fist.map(point => ({ ...point }));
    points[5] = { x: 0.5, y: 0.5 };
    points[6] = { x: 0.5 + (tip.x - 0.5) / 3, y: 0.5 + (tip.y - 0.5) / 3 };
    points[7] = { x: 0.5 + (tip.x - 0.5) * 2 / 3, y: 0.5 + (tip.y - 0.5) * 2 / 3 };
    points[8] = tip;
    return points;
  };
  assert.equal(classifyPointDirection(pointIn({ x: 0.5, y: 0.1 }), 0.9), 'up');
  assert.equal(classifyPointDirection(pointIn({ x: 0.9, y: 0.5 }), 0.9), 'right');
  assert.equal(classifyPointDirection(pointIn({ x: 0.5, y: 0.9 }), 0.9), 'down');
  assert.equal(classifyPointDirection(pointIn({ x: 0.1, y: 0.5 }), 0.9), 'left');
  assert.equal(classifyPointDirection(fist, 0.9), undefined);
});

test('keeps handedness labels and keeps an index point out of fist and open-palm states', () => {
  const indexOnly = openHand.map((point, index) => index >= 9 ? fist[index]! : point);
  const detected = classifyGestureHand('Left', 0.9, indexOnly);
  assert.equal(normalizeMediaPipeHandedness('Left'), 'Left');
  assert.equal(normalizeMediaPipeHandedness('Right'), 'Right');
  assert.equal(detected.handedness, 'Left');
  assert.equal(detected.fingerCount, 1);
  assert.equal(detected.pose, 'neutral');
  assert.equal(detected.pointDirection, 'up');
  assert.equal(detected.indexBent, false);
});

test('keeps MediaPipe handedness labels for the unmirrored camera input', () => {
  assert.equal(normalizeMediaPipeHandedness('Right'), 'Right');
  assert.equal(normalizeMediaPipeHandedness('Left'), 'Left');
});

test('does not classify a zero-finger fist as a thumb-index pinch', () => {
  const detected = classifyGestureHand('Right', 0.9, fist);
  assert.equal(detected.fingerCount, 0);
  assert.equal(detected.pose, 'fist');
  assert.equal(detected.pinching, false);
});

test('recognizer closed-fist result overrides an ambiguous custom finger count', () => {
  const detected = classifyGestureHand('Left', 0.9, openHand);
  applyRecognizerPose(detected, 'Closed_Fist', 0.8);
  assert.equal(detected.pose, 'fist');
});
