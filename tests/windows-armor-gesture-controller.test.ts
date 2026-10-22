import test from 'node:test';
import assert from 'node:assert/strict';
import { ArmorGestureController, type GestureHand } from '../src/gesture/armor-gesture-controller.ts';

function hand(overrides: Partial<GestureHand> = {}): GestureHand {
  return {
    handedness: 'Right', confidence: 0.95, pose: 'neutral', fingerCount: 0,
    pointDirection: undefined, indexBent: false, pinching: false,
    palmCenter: { x: 0.5, y: 0.5 }, pinchCenter: { x: 0.5, y: 0.5 },
    landmarks: Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5 })),
    ...overrides,
  };
}

test('left-hand finger counts change modes once and keep reset before the announcement action', () => {
  const controller = new ArmorGestureController();
  assert.deepEqual(controller.update([hand({ handedness: 'Left', fingerCount: 2 })], 0), []);
  assert.deepEqual(controller.update([hand({ handedness: 'Left', fingerCount: 2 })], 600), [
    { type: 'mode-change', mode: 2, resetAll: true, announcement: '切换至模式 2' },
  ]);
  assert.deepEqual(controller.update([hand({ handedness: 'Left', fingerCount: 2 })], 900), []);
  assert.deepEqual(controller.update([hand({ handedness: 'Left', fingerCount: 3 })], 1000), []);
  assert.deepEqual(controller.update([hand({ handedness: 'Left', fingerCount: 3 })], 1600), [
    { type: 'mode-change', mode: 3, resetAll: true, announcement: '切换至模式 3' },
  ]);
});

test('right-hand open palm and fist control fragments in mode one and groups in mode two', () => {
  const controller = new ArmorGestureController();
  assert.deepEqual(controller.update([hand({ pose: 'open', fingerCount: 4 })], 0), []);
  assert.deepEqual(controller.update([hand({ pose: 'open', fingerCount: 4 })], 300), [
    { type: 'disperse', scope: 'fragments', value: true },
  ]);
  assert.deepEqual(controller.update([hand({ pose: 'fist' })], 400), []);
  assert.deepEqual(controller.update([hand({ pose: 'fist' })], 700), [
    { type: 'disperse', scope: 'fragments', value: false },
  ]);
  controller.update([hand({ handedness: 'Left', fingerCount: 2 })], 800);
  controller.update([hand({ handedness: 'Left', fingerCount: 2 })], 1400);
  assert.deepEqual(controller.update([hand({ pose: 'open', fingerCount: 4 })], 1500), []);
  assert.deepEqual(controller.update([hand({ pose: 'open', fingerCount: 4 })], 1800), [
    { type: 'disperse', scope: 'groups', value: true },
  ]);
});

test('applies a stable open palm without waiting for a long pause', () => {
  const controller = new ArmorGestureController();
  controller.update([hand({ pose: 'open', fingerCount: 4 })], 0);
  assert.deepEqual(controller.update([hand({ pose: 'open', fingerCount: 4 })], 160), [
    { type: 'disperse', scope: 'fragments', value: true },
  ]);
});

test('uses left palm for rotation while right palm independently controls dispersal', () => {
  const controller = new ArmorGestureController();
  const leftOpen = hand({ handedness: 'Left', pose: 'open', fingerCount: 4, palmCenter: { x: 0.4, y: 0.5 } });
  const rightOpen = hand({ handedness: 'Right', pose: 'open', fingerCount: 4, palmCenter: { x: 0.7, y: 0.5 } });
  controller.update([leftOpen, rightOpen], 0);
  assert.deepEqual(controller.update([leftOpen, rightOpen], 160), [
    { type: 'disperse', scope: 'fragments', value: true },
  ]);
  const movingLeft = { ...leftOpen, palmCenter: { x: 0.55, y: 0.5 } };
  const rotation = controller.update([movingLeft, rightOpen], 220);
  assert.equal(rotation[0]?.type, 'rotate');
  assert.ok(rotation[0]?.type === 'rotate' && Math.abs(rotation[0].deltaX + 0.15) < 1e-9);
  const movingRight = { ...rightOpen, palmCenter: { x: 0.9, y: 0.5 } };
  assert.deepEqual(controller.update([movingLeft, movingRight], 280), []);
});

test('left hand does not disperse armor; right hand controls dispersal', () => {
  const controller = new ArmorGestureController();
  const leftOpen = hand({ handedness: 'Left', pose: 'open', fingerCount: 4 });
  assert.deepEqual(controller.update([leftOpen], 0), []);
  assert.deepEqual(controller.update([leftOpen], 160), []);
  const rightOpen = hand({ handedness: 'Right', pose: 'open', fingerCount: 4 });
  controller.update([rightOpen], 200);
  assert.deepEqual(controller.update([rightOpen], 360), [{ type: 'disperse', scope: 'fragments', value: true }]);
  const leftFist = hand({ handedness: 'Left', pose: 'fist', fingerCount: 0 });
  assert.deepEqual(controller.update([leftFist], 400), []);
  const rightFist = hand({ handedness: 'Right', pose: 'fist', fingerCount: 0 });
  controller.update([rightFist], 420);
  assert.deepEqual(controller.update([rightFist], 580), [{ type: 'disperse', scope: 'fragments', value: false }]);
});

test('treats a zero-finger closed hand as a fist even when pose classification is neutral', () => {
  const controller = new ArmorGestureController();
  const open = hand({ pose: 'open', fingerCount: 4 });
  controller.update([open], 0);
  assert.deepEqual(controller.update([open], 160), [{ type: 'disperse', scope: 'fragments', value: true }]);
  const closed = hand({ pose: 'neutral', fingerCount: 0 });
  controller.update([closed], 200);
  assert.deepEqual(controller.update([closed], 360), [{ type: 'disperse', scope: 'fragments', value: false }]);
});

test('left palm horizontal movement rotates while head direction navigates and OK confirms', () => {
  const controller = new ArmorGestureController();
  controller.update([hand({ handedness: 'Left', fingerCount: 3 })], 0);
  const mode = controller.update([hand({ handedness: 'Left', fingerCount: 3 })], 600);
  assert.equal(mode[0]?.type, 'mode-change');
  controller.update([hand({ handedness: 'Left', pose: 'open', fingerCount: 4, palmCenter: { x: 0.4, y: 0.5 } })], 700);
  const rotation = controller.update([hand({ handedness: 'Left', pose: 'open', fingerCount: 4, palmCenter: { x: 0.6, y: 0.5 } })], 767);
  assert.equal(rotation[0]?.type, 'rotate');
  assert.ok(rotation[0]?.type === 'rotate' && Math.abs(rotation[0].deltaX + 0.2) < 1e-9);
  const neutral = hand({ fingerCount: 1 });
  assert.deepEqual(controller.update([neutral], 800, 'left'), []);
  assert.deepEqual(controller.update([neutral], 1050, 'left'), [{ type: 'select-direction', direction: 'left' }]);
  const ok = hand({ pinching: true, okGesture: true, fingerCount: 3 });
  assert.deepEqual(controller.update([ok], 1100), []);
  assert.deepEqual(controller.update([ok], 1300), [{ type: 'confirm-selection' }]);
  const leftFist = hand({ handedness: 'Left', pose: 'fist', fingerCount: 0, palmCenter: { x: 0.42, y: 0.63 } });
  assert.deepEqual(controller.update([leftFist], 1300), []);
  assert.deepEqual(controller.update([leftFist], 1450), [{ type: 'face-forward' }]);
});

test('mode three ignores component dispersion and uses right fist for full reset', () => {
  const controller = new ArmorGestureController();
  controller.reset(3);
  const rightOpen = hand({ pose: 'open', fingerCount: 4 });
  assert.deepEqual(controller.update([rightOpen], 0), []);
  assert.deepEqual(controller.update([rightOpen], 200), []);
  const rightFist = hand({ pose: 'fist', fingerCount: 0 });
  assert.deepEqual(controller.update([rightFist], 300), []);
  assert.deepEqual(controller.update([rightFist], 450), [{ type: 'reset-all' }]);
  assert.deepEqual(controller.update([rightFist], 600), []);
});

test('two hands held together restore all armor and suppress other gestures', () => {
  const controller = new ArmorGestureController();
  const together = [
    hand({ handedness: 'Left', fingerCount: 1, palmCenter: { x: 0.45, y: 0.5 } }),
    hand({ handedness: 'Right', pose: 'open', palmCenter: { x: 0.53, y: 0.5 } }),
  ];
  assert.deepEqual(controller.update(together, 0), []);
  assert.deepEqual(controller.update(together, 600), [{ type: 'reset-all' }]);
  assert.deepEqual(controller.update(together, 900), []);
});

test('mode-selection fingers take priority over a held open right palm', () => {
  const controller = new ArmorGestureController();
  const both = [
    hand({ handedness: 'Left', fingerCount: 2, palmCenter: { x: 0.3, y: 0.5 } }),
    hand({ handedness: 'Right', pose: 'open', fingerCount: 4, palmCenter: { x: 0.7, y: 0.5 } }),
  ];
  assert.deepEqual(controller.update(both, 0), []);
  assert.deepEqual(controller.update(both, 600), [
    { type: 'mode-change', mode: 2, resetAll: true, announcement: '切换至模式 2' },
  ]);
  assert.deepEqual(controller.update(both, 900), []);
  assert.deepEqual(controller.update(both, 1200), []);
});

test('clears transient hand state without changing the active mode', () => {
  const controller = new ArmorGestureController();
  controller.update([hand({ handedness: 'Left', fingerCount: 3 })], 0);
  controller.update([hand({ handedness: 'Left', fingerCount: 3 })], 600);
  controller.reset(3);
  assert.equal(controller.mode, 3);
});

test('does not rotate from a stale open label when the hand has closed', () => {
  const controller = new ArmorGestureController();
  controller.update([hand({ pose: 'open', fingerCount: 4, palmCenter: { x: 0.4, y: 0.5 } })], 0);
  const actions = controller.update([hand({ pose: 'open', fingerCount: 0, palmCenter: { x: 0.7, y: 0.5 } })], 100);
  assert.deepEqual(actions, []);
});

test('left fist requests a smooth front-facing turn in modes one and two', () => {
  for (const mode of [1, 2] as const) {
    const controller = new ArmorGestureController();
    controller.reset(mode);
    const leftFist = hand({ handedness: 'Left', pose: 'fist', fingerCount: 0 });
    controller.update([leftFist], 0);
    assert.deepEqual(controller.update([leftFist], 160), [{ type: 'face-forward' }]);
    assert.deepEqual(controller.update([leftFist], 320), []);
    assert.deepEqual(controller.update([], 480), []);
    assert.deepEqual(controller.update([leftFist], 960), []);
  }
});

test('mode three keeps the left fist reserved for facing forward', () => {
  const controller = new ArmorGestureController();
  controller.reset(3);
  const leftFist = hand({ handedness: 'Left', pose: 'fist', fingerCount: 0, palmCenter: { x: 0.42, y: 0.63 } });
  assert.deepEqual(controller.update([leftFist], 0), []);
  assert.deepEqual(controller.update([leftFist], 140), [{ type: 'face-forward' }]);
});

test('left OK gesture turns the armor forward once without changing modes', () => {
  const controller = new ArmorGestureController();
  controller.reset(2);
  const leftOk = hand({ handedness: 'Left', fingerCount: 3, pinching: true, okGesture: true });
  assert.deepEqual(controller.update([leftOk], 0), []);
  assert.deepEqual(controller.update([leftOk], 200), [{ type: 'face-forward' }]);
  assert.equal(controller.mode, 2);
  assert.deepEqual(controller.update([leftOk], 400), []);
});

test('mode three uses the right index tip to drag the selected component', () => {
  const controller = new ArmorGestureController();
  controller.reset(3);
  const rightIndex = hand({ handedness: 'Right', fingerCount: 1, pointDirection: 'up', indexTip: { x: 0.62, y: 0.44 } });
  assert.deepEqual(controller.update([rightIndex], 0), []);
  assert.deepEqual(controller.update([rightIndex], 120), [{ type: 'drag-start', point: { x: 0.62, y: 0.44 } }]);
  assert.deepEqual(controller.update([rightIndex], 200), [{ type: 'drag-move', point: { x: 0.62, y: 0.44 } }]);
});

test('a fist pose takes priority over an occasional one-finger miscount', () => {
  const controller = new ArmorGestureController();
  const leftFist = hand({ handedness: 'Left', pose: 'fist', fingerCount: 1 });
  controller.update([leftFist], 0);
  assert.deepEqual(controller.update([leftFist], 160), [{ type: 'face-forward' }]);
});

test('a zero-finger closed hand restores parts even if landmarks resemble a pinch', () => {
  const controller = new ArmorGestureController();
  const open = hand({ pose: 'open', fingerCount: 4 });
  controller.update([open], 0);
  controller.update([open], 160);
  const fistWithThumbContact = hand({ pose: 'fist', fingerCount: 0, pinching: true });
  controller.update([fistWithThumbContact], 200);
  assert.deepEqual(controller.update([fistWithThumbContact], 360), [
    { type: 'disperse', scope: 'fragments', value: false },
  ]);
});

test('mode three allows the same head direction again after returning to neutral', () => {
  const controller = new ArmorGestureController();
  controller.reset(3);
  const neutral = hand({ fingerCount: 1 });
  assert.deepEqual(controller.update([neutral], 0, 'left'), []);
  assert.deepEqual(controller.update([neutral], 200, 'left'), [{ type: 'select-direction', direction: 'left' }]);
  controller.update([neutral], 250, undefined);
  controller.update([neutral], 450, undefined);
  assert.deepEqual(controller.update([neutral], 500, 'left'), []);
  assert.deepEqual(controller.update([neutral], 700, 'left'), [{ type: 'select-direction', direction: 'left' }]);
});

test('mode three can select with head direction even when no hand is currently actionable', () => {
  const controller = new ArmorGestureController();
  controller.reset(3);
  assert.deepEqual(controller.update([], 0, 'up'), []);
  assert.deepEqual(controller.update([], 200, 'up'), [{ type: 'select-direction', direction: 'up' }]);
});
