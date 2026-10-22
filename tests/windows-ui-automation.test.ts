import assert from 'node:assert/strict';
import test from 'node:test';
import { UiAutomationSession, type UiAutomationProbe } from '../electron/ui-automation.ts';

function probe(overrides: Partial<UiAutomationProbe> = {}) {
  let foreground = { handle: '100', title: 'Untitled - Notepad', processName: 'notepad', processId: 10 };
  const calls: unknown[] = [];
  const base: UiAutomationProbe = {
    inspect: async () => ({ foreground, controls: [
      { runtimeId: [1, 2], role: 'Edit', name: 'Text editor', enabled: true, focused: true, password: false, patterns: ['setValue', 'scroll'] },
      { runtimeId: [1, 3], role: 'Edit', name: 'Password', enabled: true, focused: false, password: true, patterns: ['setValue'] },
    ] }),
    perform: async request => {
      calls.push(request);
      return { foregroundHandle: foreground.handle, verified: true, state: request.action.type === 'setValue' ? 'valueLength:5' : 'completed' };
    },
  };
  const result = { session: new UiAutomationSession({ ...base, ...overrides, inspect: async () => overrides.inspect ? overrides.inspect() : base.inspect() }), calls, setForeground(value: typeof foreground) { foreground = value; } };
  return result;
}

test('inspection is bounded and exposes only safe control metadata with opaque IDs', async () => {
  const p = probe();
  const result = await p.session.inspect();
  assert.equal(result.controls.length, 2);
  assert.ok(result.controls.every(control => control.id.length >= 16));
  assert.equal(JSON.stringify(result).includes('runtimeId'), false);
  assert.deepEqual(result.controls[0]!.patterns, ['setValue', 'scroll']);
});

test('password controls cannot be targeted for text entry', async () => {
  const p = probe();
  const result = await p.session.inspect();
  assert.equal((await p.session.act({ controlId: result.controls[1]!.id, action: { type: 'setValue', text: 'secret' } })).success, false);
  assert.equal(p.calls.length, 0);
});

test('control IDs expire and cannot be used after foreground window changes', async () => {
  let now = 100;
  const p = probe();
  const session = new UiAutomationSession(p.session.probe, { now: () => now, ttlMs: 30_000 });
  const result = await session.inspect();
  now += 30_001;
  assert.equal((await session.act({ controlId: result.controls[0]!.id, action: { type: 'invoke' } })).success, false);

  now = 200;
  const fresh = await session.inspect();
  p.setForeground({ handle: '200', title: 'Browser', processName: 'browser', processId: 20 });
  assert.equal((await session.act({ controlId: fresh.controls[0]!.id, action: { type: 'invoke' } })).success, false);
  assert.equal(p.calls.length, 0);
});

test('text entry and scroll ranges are bounded and verified', async () => {
  const p = probe();
  const result = await p.session.inspect();
  assert.equal((await p.session.act({ controlId: result.controls[0]!.id, action: { type: 'setValue', text: 'x'.repeat(2001) } })).success, false);
  const set = await p.session.act({ controlId: result.controls[0]!.id, action: { type: 'setValue', text: 'hello' } });
  assert.deepEqual(set, { success: true, verified: true, state: 'valueLength:5' });
  assert.equal((await p.session.act({ controlId: result.controls[0]!.id, action: { type: 'scroll', direction: 'down', amount: 100 } })).success, false);
  assert.equal(p.calls.length, 1);
});

test('action is rejected when adapter verification fails or foreground changed during execution', async () => {
  const p = probe({ perform: async () => ({ foregroundHandle: 'different', verified: false, state: 'unverified' }) });
  const result = await p.session.inspect();
  const action = await p.session.act({ controlId: result.controls[0]!.id, action: { type: 'invoke' } });
  assert.equal(action.success, false);
  assert.equal(action.verified, false);
});
