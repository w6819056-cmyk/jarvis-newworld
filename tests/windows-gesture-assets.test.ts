import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { verifyAsset } from '../scripts/download-hand-landmarker.mjs';

test('asset verification checks exact byte count and SHA-256', () => {
  const bytes = Buffer.from('hand-model-fixture');
  const hash = createHash('sha256').update(bytes).digest('hex');
  assert.equal(verifyAsset(bytes, bytes.length, hash), true);
  assert.equal(verifyAsset(Buffer.from('hand-model-fixturE'), bytes.length, hash), false);
  assert.equal(verifyAsset(bytes, bytes.length + 1, hash), false);
});
