import test from 'node:test';
import assert from 'node:assert/strict';
import { matchInspectionCommand } from '../electron/inspection-commands.ts';
import { VoiceGate } from '../electron/voice-gate.ts';

test('recognizes the exact enter command after wake-gate text extraction', () => {
  assert.equal(matchInspectionCommand('检查一下战甲', false), 'enter');
  assert.equal(matchInspectionCommand('检查一下，战甲。', false), 'enter');
  assert.equal(matchInspectionCommand('检查 一下 战甲！', false), 'enter');
});

test('recognizes natural command variants and likely speech recognition substitutions', () => {
  for (const phrase of ['检查战甲', '检查下战甲', '检测一下战甲', '查看一下战甲', '看一下战甲', '检查一下盔甲', '检查一下机甲', '检查机甲', '检测一下铠甲']) {
    assert.equal(matchInspectionCommand(phrase, false), 'enter', phrase);
  }
});

test('recognizes exit only while inspection is active', () => {
  assert.equal(matchInspectionCommand('结束检查', true), 'exit');
  assert.equal(matchInspectionCommand('结束，检查。', true), 'exit');
  assert.equal(matchInspectionCommand('结束检查', false), undefined);
});

test('does not intercept ordinary requests or repeat the current mode command', () => {
  assert.equal(matchInspectionCommand('帮我检查一下战甲', false), undefined);
  assert.equal(matchInspectionCommand('结束检查然后打开浏览器', true), undefined);
  assert.equal(matchInspectionCommand('检查一下战甲', true), undefined);
});

test('wake phrase and inspection command can share one utterance, including exit', () => {
  const gate = new VoiceGate();
  const enter = gate.accept('嗨贾维斯，检查一下战甲', true, 0);
  assert.equal(matchInspectionCommand(enter.text, false), 'enter');
  const exit = gate.accept('嗨贾维斯，结束检查', true, 1);
  assert.equal(matchInspectionCommand(exit.text, true), 'exit');
});
