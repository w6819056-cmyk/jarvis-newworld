import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { submitCommandInput } from '../src/command-input.ts';

const renderer = await readFile(new URL('../src/windows-main.ts', import.meta.url), 'utf8');

test('submits trimmed typed commands and clears the field after acceptance', async () => {
  const input = { value: '  帮我看看上海天气  ' };
  const sent: string[] = [];

  const accepted = await submitCommandInput(input, async text => { sent.push(text); return true; });

  assert.equal(accepted, true);
  assert.deepEqual(sent, ['帮我看看上海天气']);
  assert.equal(input.value, '');
});

test('keeps typed commands when sending fails and ignores blank input', async () => {
  const input = { value: '打开浏览器' };
  const rejected = await submitCommandInput(input, async () => false);
  assert.equal(rejected, false);
  assert.equal(input.value, '打开浏览器');

  input.value = '   ';
  const blank = await submitCommandInput(input, async () => assert.fail('blank input must not be sent'));
  assert.equal(blank, false);
  assert.equal(input.value, '   ');
});

test('the command form submits through the shared send action and documents Enter', () => {
  assert.match(renderer, /submitCommandInput\(input, text => action\(\{ type: 'send', text \}\)\)/);
  assert.match(renderer, /placeholder="输入指令后按 Enter 或点击发送/);
  assert.match(renderer, /type="submit" aria-label="发送指令" title="发送指令"/);
});
