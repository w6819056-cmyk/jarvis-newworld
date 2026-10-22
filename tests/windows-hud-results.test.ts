import assert from 'node:assert/strict';
import test from 'node:test';
import { HudResults } from '../src/hud-results.ts';

test('starts empty and appends results in creation order without a count limit', () => {
  const hud = new HudResults();
  assert.deepEqual(hud.items(), []);
  const ids = Array.from({ length: 150 }, () => hud.begin());
  assert.equal(hud.items().length, 150);
  assert.deepEqual(hud.items().map(item => item.id), ids);
  assert.ok(hud.items().every(item => item.pending));
});

test('updates one result and removes only the selected result', () => {
  const hud = new HudResults();
  const first = hud.begin();
  const second = hud.begin();
  const third = hud.begin();
  hud.update(second, '上海当前天气：晴朗。', false);
  hud.close(second);
  hud.update(second, 'late update', true);
  assert.deepEqual(hud.items().map(item => item.id), [first, third]);
  assert.deepEqual(hud.items().map(item => item.text), ['', '']);
});

test('returns independent snapshots so renderer updates cannot mutate stored results', () => {
  const hud = new HudResults();
  const id = hud.begin();
  const snapshot = hud.items() as { id: number; text: string; pending: boolean }[];
  snapshot[0]!.text = 'external';
  assert.equal(hud.items()[0]!.text, '');
  hud.update(id, '完成', false);
  assert.equal(hud.items()[0]!.text, '完成');
});
