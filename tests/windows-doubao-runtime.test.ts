import assert from 'node:assert/strict';
import test from 'node:test';
import { float32ToPcm16, extractDoubaoTranscript, extractDoubaoError, isDoubaoAudioFrame, isDoubaoTtsFinished, doubaoPlaybackDurationMs } from '../electron/doubao-runtime.ts';

test('Doubao audio conversion clamps float samples to signed PCM16', () => {
  const pcm = float32ToPcm16(new Float32Array([-1, -0.5, 0, 0.5, 1]));
  assert.deepEqual(Array.from({ length: 5 }, (_, index) => pcm.readInt16LE(index * 2)), [-32768, -16384, 0, 16384, 32767]);
});

test('Doubao response extraction returns final and partial text', () => {
  assert.deepEqual(extractDoubaoTranscript({ payload_msg: { result: [{ text: '打开浏览器', definite: true }] } }), { text: '打开浏览器', final: true });
  assert.deepEqual(extractDoubaoTranscript({ payload_msg: { result: [{ text: '打开浏览器', definite: false }] } }), { text: '打开浏览器', final: false });
  assert.deepEqual(extractDoubaoTranscript({ result: { text: '嗨贾维斯', definite: true } }), { text: '嗨贾维斯', final: true });
  assert.deepEqual(extractDoubaoTranscript({ result: { text: '嗨贾维斯', definite: 1 } }), { text: '嗨贾维斯', final: true });
  assert.deepEqual(extractDoubaoTranscript({ result: { text: '嗨贾维斯' }, is_final: 1 }), { text: '嗨贾维斯', final: true });
  assert.deepEqual(extractDoubaoTranscript({ payload_msg: JSON.stringify({ result: JSON.stringify({ text: '嗨贾维斯', definite: true }) }) }), { text: '嗨贾维斯', final: true });
  assert.deepEqual(extractDoubaoTranscript({ additions: { text: '嗨贾维斯' }, is_last_package: 1 }), { text: '嗨贾维斯', final: true });
  assert.deepEqual(extractDoubaoTranscript({ payload_msg: { result: [{ text: '嗨贾维斯', is_last_package: 1 }] } }), { text: '嗨贾维斯', final: true });
  assert.deepEqual(extractDoubaoTranscript({ payload_msg: { result: [{ text: '嗨贾维斯', definite: false }], is_final: 1 } }), { text: '嗨贾维斯', final: true });
});

test('Doubao TTS recognizes audio-only frames and completion events', () => {
  assert.equal(isDoubaoAudioFrame(Buffer.from([0x11, 0xb0, 0x00, 0x00])), true);
  assert.equal(isDoubaoAudioFrame(Buffer.from([0x11, 0x90, 0x10, 0x00])), false);
  assert.equal(isDoubaoTtsFinished({ event: 'TTSSentenceEnd' }), true);
  assert.equal(isDoubaoTtsFinished({ event: 'TTSResponse' }), false);
});

test('Doubao playback duration includes every 24 kHz mono PCM sample', () => {
  assert.equal(doubaoPlaybackDurationMs([Buffer.alloc(24000), Buffer.alloc(24000)]), 1000);
  assert.equal(doubaoPlaybackDurationMs([]), 0);
});

test('Doubao response errors are surfaced with code and message', () => {
  assert.equal(extractDoubaoError({ code: 401, message: 'invalid api key' }), '豆包返回错误 401：invalid api key');
  assert.equal(extractDoubaoError({ code: 0 }), undefined);
});
