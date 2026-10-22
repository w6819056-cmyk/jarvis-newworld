import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const renderer = await readFile(new URL('../src/windows-main.ts', import.meta.url), 'utf8');
const styles = await readFile(new URL('../src/windows.css', import.meta.url), 'utf8');

test('HUD stack is initially hidden and contains result-only cards with independent close controls', () => {
  assert.match(renderer, /<aside id="hud-results"[^>]*hidden/);
  assert.match(renderer, /id="hud-results-list"/);
  assert.match(renderer, /data-hud-close/);
  assert.match(renderer, /textContent = item\.text/);
  assert.doesNotMatch(renderer.match(/id="hud-results"[\s\S]*?<\/aside>/)?.[0] ?? '', /本次识别|transcript|user command/i);
});

test('each reply turn begins a separate HUD and streaming updates target the active card', () => {
  assert.match(renderer, /hudResults\.begin\(\)/);
  assert.match(renderer, /hudResults\.update\(currentHudId/);
  assert.match(renderer, /hudResults\.close\(id\)/);
  assert.match(renderer, /const started = next\.busy && !wasBusy/);
});

test('recognized speech remains in its separate caption and is not passed to HUD text', () => {
  assert.match(renderer, /#live-transcript-text/);
  assert.match(renderer, /renderHudResults\(\)/);
  assert.doesNotMatch(renderer, /hudResults\.update\([^\n]*next\.transcript/);
});

test('HUD stack scrolls independently and stays within the screen bounds', () => {
  assert.match(styles, /\.windows-shell \.win-hud-stack\{[^}]*position:absolute/);
  assert.match(styles, /\.windows-shell \.win-hud-stack\{[^}]*overflow-y:auto/);
  assert.match(styles, /\.win-hud-stack\[hidden\]\{display:none\}/);
  assert.match(styles, /\.win-hud-card>header button/);
  assert.match(styles, /@media\(max-width:700px\)/);
});
