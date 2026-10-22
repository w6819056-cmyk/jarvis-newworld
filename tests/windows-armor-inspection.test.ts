import test from 'node:test';
import assert from 'node:assert/strict';
import { ArmorInspection, shouldApplyGestureStatus } from '../src/armor-inspection.ts';

function fixture(startCamera: () => Promise<void> = async () => {}) {
  const events: string[] = [];
  const inspection = new ArmorInspection({
    setVisible: visible => events.push(visible ? 'show' : 'hide'),
    startCamera: () => { events.push('camera-start'); return startCamera(); },
    stopCamera: () => events.push('camera-stop'),
    resetGestures: () => events.push('gesture-reset'),
    setDispersal: value => events.push(`dispersal:${value}`),
  });
  return { inspection, events };
}

test('enter reveals the armor before starting camera and repeated enter has no side effects', async () => {
  const { inspection, events } = fixture();
  await inspection.enter();
  await inspection.enter();
  assert.equal(inspection.active, true);
  assert.deepEqual(events, ['gesture-reset', 'dispersal:0', 'show', 'camera-start']);
});

test('camera denial leaves inspection active and the armor visible', async () => {
  const { inspection, events } = fixture(async () => { throw new Error('camera denied'); });
  await assert.rejects(inspection.enter(), /camera denied/);
  assert.equal(inspection.active, true);
  assert.deepEqual(events, ['gesture-reset', 'dispersal:0', 'show', 'camera-start']);
});

test('exit stops camera before assembling and hiding armor and repeated exit is harmless', async () => {
  const { inspection, events } = fixture();
  await inspection.enter();
  inspection.exit();
  inspection.exit();
  assert.equal(inspection.active, false);
  assert.deepEqual(events, ['gesture-reset', 'dispersal:0', 'show', 'camera-start', 'camera-stop', 'gesture-reset', 'dispersal:0', 'hide']);
});

test('late camera errors are ignored after capture stops but off status is still applied', () => {
  assert.equal(shouldApplyGestureStatus(false, 'error'), false);
  assert.equal(shouldApplyGestureStatus(false, 'off'), true);
  assert.equal(shouldApplyGestureStatus(true, 'error'), true);
});
