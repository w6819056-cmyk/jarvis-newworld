import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeFrame, encodeFrame, MINERADIO_MAX_FRAME_BYTES, validateRequest } from '../electron/mineradio-protocol.ts';

test('encodes and decodes a bounded protocol frame', () => {
  const value = { version: 1, type: 'request', id: 'r1', action: 'player.pause', payload: {} };
  assert.deepEqual(decodeFrame(encodeFrame(value)), value);
});

test('rejects malformed, oversized, and arbitrary command frames', () => {
  assert.throws(() => decodeFrame('{bad'));
  assert.throws(() => encodeFrame({ value: 'x'.repeat(MINERADIO_MAX_FRAME_BYTES) }));
  assert.throws(() => validateRequest({ version: 1, type: 'request', id: 'x', action: 'exec.shell', payload: {} }));
});

test('validates known action payloads and rejects out-of-range values', () => {
  assert.equal(validateRequest({ version: 1, type: 'request', id: '1', action: 'player.set_volume', payload: { volume: 30 } }).action, 'player.set_volume');
  assert.throws(() => validateRequest({ version: 1, type: 'request', id: '2', action: 'player.set_volume', payload: { volume: 130 } }));
});

test('validates visual preset selectors as one strict built-in ID or random request', () => {
  const request = (payload: Record<string, unknown>) => ({ version: 1, type: 'request', id: 'preset', action: 'visual.set_preset', payload });
  assert.equal(validateRequest(request({ presetId: 0 })).action, 'visual.set_preset');
  assert.equal(validateRequest(request({ presetId: 12 })).action, 'visual.set_preset');
  assert.equal(validateRequest(request({ random: true })).action, 'visual.set_preset');
  assert.throws(() => validateRequest(request({ presetId: -1 })));
  assert.throws(() => validateRequest(request({ presetId: 13 })));
  assert.throws(() => validateRequest(request({})));
  assert.throws(() => validateRequest(request({ presetId: 10, random: true })));
  assert.throws(() => validateRequest(request({ presetId: 10, command: 'setPreset(10)' })));
});
