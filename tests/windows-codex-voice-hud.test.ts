import assert from 'node:assert/strict';
import test from 'node:test';
import { HudResults } from '../src/hud-results.ts';
import { CodexVoiceHud } from '../src/codex-voice-hud.ts';

const assistant = (text: string) => ({ method: 'thread/realtime/transcript/done', params: { role: 'assistant', threadId: 'thread-1', text } });
const user = (text: string) => ({ method: 'thread/realtime/transcript/done', params: { role: 'user', threadId: 'thread-1', text } });

test('final Codex Voice assistant reply creates a completed HUD result', () => {
  const results = new HudResults();
  const voiceHud = new CodexVoiceHud(results);
  const id = voiceHud.accept(assistant('网页结果显示今天晴天，来源：天气网。'));
  assert.equal(id, 1);
  assert.deepEqual(results.items(), [{ id: 1, text: '网页结果显示今天晴天，来源：天气网。', pending: false }]);
});

test('an identical repeated final event is ignored until the next user turn', () => {
  const results = new HudResults();
  const voiceHud = new CodexVoiceHud(results);
  assert.equal(voiceHud.accept(assistant('找到三个结果。')), 1);
  assert.equal(voiceHud.accept(assistant('找到三个结果。')), undefined);
  assert.equal(voiceHud.accept(user('再搜一次。')), undefined);
  assert.equal(voiceHud.accept(assistant('找到三个结果。')), 2);
  assert.deepEqual(results.items().map(item => item.text), ['找到三个结果。', '找到三个结果。']);
});

test('partial, audio, empty, and unrelated events do not create HUD results', () => {
  const results = new HudResults();
  const voiceHud = new CodexVoiceHud(results);
  assert.equal(voiceHud.accept({ method: 'thread/realtime/transcript/delta', params: { role: 'assistant', threadId: 'thread-1', text: 'partial' } }), undefined);
  assert.equal(voiceHud.accept({ method: 'thread/realtime/audio/done', params: { role: 'assistant', text: 'ignored' } }), undefined);
  assert.equal(voiceHud.accept(assistant(' ')), undefined);
  assert.equal(voiceHud.accept({ method: 'other', params: { role: 'assistant', threadId: 'thread-1', text: 'ignored' } }), undefined);
  assert.deepEqual(results.items(), []);
});
