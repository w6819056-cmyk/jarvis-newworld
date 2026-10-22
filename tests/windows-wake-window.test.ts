import assert from 'node:assert/strict';
import test from 'node:test';
import { showWakeWindow, type WakeWindow } from '../electron/wake-window.ts';

function createWindow(minimized: boolean) {
  const calls: string[] = [];
  const window: WakeWindow = {
    isMinimized: () => minimized,
    restore: () => calls.push('restore'),
    setAlwaysOnTop: () => calls.push('top'),
    show: () => calls.push('show'),
    focus: () => calls.push('focus'),
  };
  return { calls, window };
}

test('wake raises a background window to the desktop', () => {
  const { calls, window } = createWindow(false);
  showWakeWindow(window);
  assert.deepEqual(calls, ['top', 'show', 'focus']);
});

test('wake restores a minimized window before raising it', () => {
  const { calls, window } = createWindow(true);
  showWakeWindow(window);
  assert.deepEqual(calls, ['restore', 'top', 'show', 'focus']);
});
