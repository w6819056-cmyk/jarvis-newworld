import assert from 'node:assert/strict';
import test from 'node:test';
import { matchWorkModeCommand } from '../electron/work-mode.ts';

test('recognizes the spoken work-mode entry phrase', () => {
  assert.equal(matchWorkModeCommand('开始工作了贾维斯', false), 'enter');
  assert.equal(matchWorkModeCommand('开始工作了，贾维斯！', false), 'enter');
});

test('recognizes work-mode exit phrases only while active', () => {
  assert.equal(matchWorkModeCommand('结束工作', true), 'exit');
  assert.equal(matchWorkModeCommand('退出工作模式', true), 'exit');
  assert.equal(matchWorkModeCommand('结束工作', false), undefined);
});

test('does not treat unrelated commands as work-mode controls', () => {
  assert.equal(matchWorkModeCommand('开始打开浏览器', false), undefined);
  assert.equal(matchWorkModeCommand('结束检查', true), undefined);
});
