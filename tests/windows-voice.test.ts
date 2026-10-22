import assert from 'node:assert/strict';
import test from 'node:test';
import { VoiceGate, isStopUtterance } from '../electron/voice-gate.ts';
import { TranscriptEndpoint } from '../electron/transcript-endpoint.ts';
import { stopTaskRuntime } from '../electron/task-stop.ts';
import * as codexVoice from '../src/codex-voice.ts';
const maybeExtractCodexVoiceTranscript = (codexVoice as any).extractCodexVoiceTranscript as ((event: unknown) => unknown) | undefined;
function extractCodexVoiceTranscript(event: unknown): unknown {
  if (typeof maybeExtractCodexVoiceTranscript !== 'function') throw new Error('final transcript parser is missing');
  return maybeExtractCodexVoiceTranscript(event);
}
const { extractCodexSdpAnswer } = codexVoice;

test('stopping a task interrupts the Codex turn but keeps its live voice runtime', async () => {
  const calls: string[] = [];
  await stopTaskRuntime({
    interrupt: async () => { calls.push('interrupt'); },
    shutdown: async () => { calls.push('shutdown'); },
  }, 'task');
  assert.deepEqual(calls, ['interrupt']);
});

test('replacing settings closes the runtime after interrupting its task', async () => {
  const calls: string[] = [];
  await stopTaskRuntime({
    interrupt: async () => { calls.push('interrupt'); },
    shutdown: async () => { calls.push('shutdown'); },
  }, 'settings');
  assert.deepEqual(calls, ['interrupt', 'shutdown']);
});

test('Codex Voice SDP events expose the answer for the WebRTC peer', () => {
  assert.equal(extractCodexSdpAnswer({ method: 'thread/realtime/sdp', params: { sdp: 'v=0-answer' } }), 'v=0-answer');
  assert.equal(extractCodexSdpAnswer({ method: 'thread/realtime/started', params: {} }), undefined);
});

test('Codex Voice final user transcript notification maps to a user transcript', () => {
  assert.equal(typeof extractCodexVoiceTranscript, 'function');
  assert.deepEqual(extractCodexVoiceTranscript({
    method: 'thread/realtime/transcript/done',
    params: { role: 'user', threadId: 'thread-1', text: '打开浏览器搜索天气' },
  }), {
    role: 'user', threadId: 'thread-1', text: '打开浏览器搜索天气',
  });
});

test('Codex Voice final assistant transcript notification maps to an assistant transcript', () => {
  assert.equal(typeof extractCodexVoiceTranscript, 'function');
  assert.deepEqual(extractCodexVoiceTranscript({
    method: 'thread/realtime/transcript/done',
    params: { role: 'assistant', threadId: 'thread-1', text: '好的，我来打开浏览器。' },
  }), {
    role: 'assistant', threadId: 'thread-1', text: '好的，我来打开浏览器。',
  });
});

test('Codex Voice transcript parser ignores partial, empty, audio, invalid roles, and unrelated events', () => {
  assert.equal(typeof extractCodexVoiceTranscript, 'function');
  assert.equal(extractCodexVoiceTranscript({ method: 'thread/realtime/transcript/delta', params: { role: 'user', threadId: 'thread-1', delta: '打开' } }), undefined);
  assert.equal(extractCodexVoiceTranscript({ method: 'thread/realtime/transcript/done', params: { role: 'user', threadId: 'thread-1', text: '   ' } }), undefined);
  assert.equal(extractCodexVoiceTranscript({ method: 'thread/realtime/transcript/done', params: { role: 'system', threadId: 'thread-1', text: 'ignore' } }), undefined);
  assert.equal(extractCodexVoiceTranscript({ method: 'thread/realtime/audio/done', params: { audio: 'not persisted' } }), undefined);
  assert.equal(extractCodexVoiceTranscript({ method: 'unknown', params: { role: 'user', threadId: 'thread-1', text: 'ignore' } }), undefined);
});

test('wake phrase preserves the command in the same breath', () => {
  const gate = new VoiceGate();
  assert.deepEqual(gate.accept('嗨，贾维斯，打开浏览器', true, 0), { wake: true, text: '打开浏览器' });
  assert.deepEqual(gate.accept('搜索天气', true, 100), { wake: false, text: '搜索天气' });
});

test('wake accepts punctuation and spaces inside the spoken name', () => {
  assert.deepEqual(new VoiceGate().accept('嗨，贾 维斯，打开浏览器', true, 0), { wake: true, text: '打开浏览器' });
  assert.deepEqual(new VoiceGate().accept('Hi Jarvis! Open the browser', true, 0), { wake: true, text: 'Open the browser' });
});
test('wake accepts the English hi jarvis phrase with a same-breath command', () => {
  assert.deepEqual(new VoiceGate().accept('Hi Jarvis, open the browser', true, 0), { wake: true, text: 'open the browser' });
});
test('a measured wake homophone preserves the command instead of silently discarding it', () => {
  const gate = new VoiceGate();
  assert.deepEqual(gate.accept('黑甲维斯打开浏览器搜索今天的天气', true, 0), { wake: true, text: '打开浏览器搜索今天的天气' });
});

test('wake accepts the greetings measured through the actual Windows microphone and capture pipeline', () => {
  for (const greeting of ['拜', '派', '海']) {
    const gate = new VoiceGate();
    assert.deepEqual(gate.accept(`${greeting}贾维斯`, false, 0), { wake: true, text: '' });
    assert.deepEqual(gate.accept(`${greeting}贾维斯打开浏览器`, true, 1), { wake: false, text: '打开浏览器' });
  }
  assert.deepEqual(new VoiceGate().accept('海甲维斯打开浏览器搜索今天的天气', true, 0), { wake: true, text: '打开浏览器搜索今天的天气' });
  assert.deepEqual(new VoiceGate().accept('派人打开浏览器', true, 0), { wake: false, text: '' });
});
test('only a standalone stop instruction interrupts a running task', () => {
  assert.equal(isStopUtterance('贾维斯，停止！'), true);
  assert.equal(isStopUtterance('停止'), true);
  assert.equal(isStopUtterance('不要停止'), false);
  assert.equal(isStopUtterance('可以点击停止按钮'), false);
});
test('idle conversation expires and unrelated background speech is ignored', () => {
  const gate = new VoiceGate();
  assert.equal(gate.accept('今天天气怎么样', true, 0).text, '');
  gate.accept('嗨贾维斯', true, 10);
  assert.equal(gate.accept('打开浏览器', true, 31011).text, '');
});
test('partial wake only fires once and busy audio cannot trigger a command', () => {
  const gate = new VoiceGate();
  assert.equal(gate.accept('嗨贾维斯', false, 0).wake, true);
  assert.equal(gate.accept('嗨贾维斯打开浏览器', false, 1).wake, false);
  assert.equal(gate.accept('嗨贾维斯打开浏览器', true, 2).text, '打开浏览器');
  gate.suspend();
  assert.equal(gate.accept('嗨贾维斯删除文件', true, 3).text, '');
  gate.resume(10);
  assert.equal(gate.accept('继续', true, 11).text, '继续');
  gate.reset();
  assert.equal(gate.accept('继续', true, 12).text, '');
});

test('a wake-only utterance requests one audible acknowledgment after the endpoint', () => {
  const gate = new VoiceGate();
  assert.equal(gate.accept('贾维斯', false, 0).acknowledge, undefined);
  assert.deepEqual(gate.accept('贾维斯', true, 1), { wake: false, text: '', acknowledge: true });
  assert.equal(gate.accept('打开浏览器', true, 2).acknowledge, undefined);
  const sameBreath = new VoiceGate();
  sameBreath.accept('嗨贾维斯', false, 0);
  assert.deepEqual(sameBreath.accept('嗨贾维斯打开浏览器', true, 1), { wake: false, text: '打开浏览器' });
  sameBreath.suspend();
  assert.equal(sameBreath.accept('贾维斯', true, 2).acknowledge, undefined);
});

test('a partial transcript is finalized after microphone silence when ASR omits an endpoint', () => {
  const endpoint = new TranscriptEndpoint({ silenceMs: 700 });

  endpoint.accept('嗨贾维斯', false, 0);
  assert.equal(endpoint.onAudio(false, 650), undefined);
  assert.equal(endpoint.onAudio(false, 701), '嗨贾维斯');
  assert.equal(endpoint.onAudio(false, 1500), undefined);
});

test('a server final clears the pending transcript so silence cannot duplicate it', () => {
  const endpoint = new TranscriptEndpoint({ silenceMs: 700 });

  endpoint.accept('打开浏览器', false, 0);
  assert.equal(endpoint.accept('打开浏览器', true, 100), '打开浏览器');
  assert.equal(endpoint.onAudio(false, 1000), undefined);
});
