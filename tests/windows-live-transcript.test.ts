import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const renderer = await readFile(new URL('../src/windows-main.ts', import.meta.url), 'utf8');
const styles = await readFile(new URL('../src/windows.css', import.meta.url), 'utf8');

test('live transcript caption is always visible and follows recognized speech', () => {
  assert.match(renderer, /id="live-transcript"[^>]*aria-label="本次识别内容"/);
  assert.match(renderer, /id="live-transcript-text">等待语音/);
  assert.match(renderer, /\$\('#live-transcript-text'\)\.textContent = next\.transcript \|\| '等待语音…'/);
  assert.match(styles, /\.win-live-transcript\{[^}]*position:absolute/);
  assert.doesNotMatch(styles, /\.win-live-transcript[^}]*visibility:hidden/);
});
