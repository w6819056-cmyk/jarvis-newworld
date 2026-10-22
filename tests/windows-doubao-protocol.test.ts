import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeDoubaoFrame, decodeDoubaoTtsFrame, encodeDoubaoJson, encodeDoubaoAudio, encodeDoubaoTtsRequest } from '../electron/doubao-protocol.ts';

test('Doubao full JSON frame uses the V3 header and raw JSON payload', async () => {
  const frame = await encodeDoubaoJson({ event: 'StartConnection' });
  assert.deepEqual([...frame.subarray(0, 4)], [0x11, 0x10, 0x10, 0x00]);
  assert.equal(frame.subarray(8, 8 + 1).toString('utf8'), '{');
  const decoded = await decodeDoubaoFrame(frame);
  assert.deepEqual(decoded.json, { event: 'StartConnection' });
});

test('Doubao audio frame carries raw PCM without JSON serialization', async () => {
  const pcm = Buffer.from([1, 2, 3, 4]);
  const frame = await encodeDoubaoAudio(pcm);
  assert.deepEqual([...frame.subarray(0, 4)], [0x11, 0x20, 0x00, 0x00]);
  const decoded = await decodeDoubaoFrame(frame);
  assert.deepEqual(decoded.payload, pcm);
});

test('Doubao sequenced server response skips the sequence number', async () => {
  const payload = Buffer.from(JSON.stringify({ result: { text: '嗨贾维斯', definite: false } }), 'utf8');
  const frame = Buffer.alloc(12 + payload.length);
  Buffer.from([0x11, 0x91, 0x10, 0x00]).copy(frame, 0);
  frame.writeInt32BE(7, 4);
  frame.writeUInt32BE(payload.length, 8);
  payload.copy(frame, 12);
  const decoded = await decodeDoubaoFrame(frame);
  assert.deepEqual(decoded.json, { result: { text: '嗨贾维斯', definite: false } });
});

test('Doubao TTS request carries event and session fields in the binary frame', async () => {
  const frame = await encodeDoubaoTtsRequest(100, 'session-1', { req_params: { text: '测试' } });
  assert.deepEqual([...frame.subarray(0, 4)], [0x11, 0x14, 0x10, 0x00]);
  assert.equal(frame.readInt32BE(4), 100);
  assert.equal(frame.subarray(12, 21).toString('utf8'), 'session-1');
  const session = Buffer.from('session-1', 'utf8');
  const payload = Buffer.from('{}', 'utf8');
  const responseBody = Buffer.concat([
    Buffer.alloc(4),
    Buffer.alloc(4),
    session,
    Buffer.alloc(4),
    payload,
  ]);
  responseBody.writeUInt32BE(150, 0);
  responseBody.writeUInt32BE(session.length, 4);
  responseBody.writeUInt32BE(payload.length, 8 + session.length);
  const response = Buffer.concat([Buffer.from([0x11, 0x94, 0x10, 0x00]), responseBody]);
  const decoded = await decodeDoubaoTtsFrame(response);
  assert.equal(decoded.event, 150);
  assert.equal(decoded.sessionId, 'session-1');
  assert.deepEqual(decoded.json, {});
});
