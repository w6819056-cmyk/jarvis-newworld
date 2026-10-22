import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyHeadDirection, HeadDirectionSmoother, type HeadDirection } from '../src/gesture/head-gesture.ts';

function face(overrides: Partial<Record<number, { x: number; y: number }>> = {}) {
  const points = Array.from({ length: 264 }, () => ({ x: 0.5, y: 0.5 }));
  points[1] = { x: 0.5, y: 0.48 };
  points[10] = { x: 0.5, y: 0.18 };
  points[152] = { x: 0.5, y: 0.82 };
  points[33] = { x: 0.35, y: 0.35 };
  points[263] = { x: 0.65, y: 0.35 };
  for (const [index, point] of Object.entries(overrides)) if (point) points[Number(index)]! = point;
  return points;
}

test('classifies stable head directions from face landmarks', () => {
  const cases: Array<[HeadDirection, ReturnType<typeof face>]> = [
    ['up', face({ 1: { x: 0.5, y: 0.36 } })],
    ['down', face({ 1: { x: 0.5, y: 0.62 } })],
    ['right', face({ 1: { x: 0.38, y: 0.48 } })],
    ['left', face({ 1: { x: 0.62, y: 0.48 } })],
  ];
  for (const [expected, landmarks] of cases) assert.equal(classifyHeadDirection(landmarks, false), expected);
});

test('ignores a centered face and incomplete face landmarks', () => {
  assert.equal(classifyHeadDirection(face(), false), undefined);
  assert.equal(classifyHeadDirection(face().slice(0, 20), false), undefined);
});

test('accepts deliberate but moderate head turns and nods', () => {
  assert.equal(classifyHeadDirection(face({ 1: { x: 0.43, y: 0.48 } }), false), 'right');
  assert.equal(classifyHeadDirection(face({ 1: { x: 0.5, y: 0.42 } }), false), 'up');
  assert.equal(classifyHeadDirection(face({ 1: { x: 0.5, y: 0.6 } }), false), 'down');
});

test('requires a direction to remain stable before publishing it', () => {
  const smoother = new HeadDirectionSmoother({ holdMs: 120 });
  assert.equal(smoother.update('left', 0), undefined);
  assert.equal(smoother.update('left', 80), undefined);
  assert.equal(smoother.update('left', 120), 'left');
});

test('holds a stable direction through a brief undefined frame', () => {
  const smoother = new HeadDirectionSmoother({ holdMs: 0, releaseMs: 180 });
  assert.equal(smoother.update('right', 0), 'right');
  assert.equal(smoother.update(undefined, 80), 'right');
  assert.equal(smoother.update(undefined, 170), 'right');
  assert.equal(smoother.update(undefined, 270), undefined);
});

test('requires neutral between opposite directions', () => {
  const smoother = new HeadDirectionSmoother({ holdMs: 0, releaseMs: 100 });
  assert.equal(smoother.update('up', 0), 'up');
  assert.equal(smoother.update('down', 20), 'up');
  assert.equal(smoother.update(undefined, 120), 'up');
  assert.equal(smoother.update(undefined, 220), undefined);
  assert.equal(smoother.update('down', 240), 'down');
});
