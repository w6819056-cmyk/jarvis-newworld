import assert from 'node:assert/strict';
import test from 'node:test';
import { DesktopControl, type DesktopControlProbe } from '../electron/desktop-control.ts';
import { LocalTools, localToolSpecs } from '../electron/local-tools.ts';

const probe: DesktopControlProbe = {
  listWindows: async () => [
    { id: 10, processName: 'notepad', title: '无标题 - 记事本' },
    { id: 20, processName: 'chrome', title: 'Jarvis' },
  ],
  focusWindow: async id => id === 20,
  openSettings: async uri => `已打开 ${uri}`,
  getVolume: async () => ({ percent: 42, muted: false }),
  setVolume: async percent => ({ percent, muted: false }),
  setMuted: async muted => ({ percent: 42, muted }),
  listProcesses: async () => [{ pid: 101, name: 'notepad', workingSetBytes: 100, cpuPercent: 2 }],
  terminateProcess: async () => true,
};

test('desktop control lists only usable titled windows and focuses the selected window', async () => {
  const control = new DesktopControl(probe);
  assert.deepEqual(await control.listWindows(), [
    { id: 10, processName: 'notepad', title: '无标题 - 记事本' },
    { id: 20, processName: 'chrome', title: 'Jarvis' },
  ]);
  assert.equal(await control.focusWindow(20), true);
  assert.equal(await control.focusWindow(99), false);
});

test('volume controls validate percentages and mute state', async () => {
  const control = new DesktopControl(probe);
  assert.deepEqual(await control.getVolume(), { percent: 42, muted: false });
  assert.deepEqual(await control.setVolume(65), { percent: 65, muted: false });
  await assert.rejects(control.setVolume(101), /音量范围/);
  assert.deepEqual(await control.setMuted(true), { percent: 42, muted: true });
});

test('process termination requires confirmation and protects Jarvis/Codex/system processes', async () => {
  const control = new DesktopControl(probe);
  assert.deepEqual(await control.listProcesses(), [{ pid: 101, name: 'notepad', workingSetBytes: 100, cpuPercent: 2 }]);
  await assert.rejects(control.terminateProcess(101, false), /确认/);
  assert.equal(await control.terminateProcess(101, true), true);
  await assert.rejects(control.terminateProcess(4, true), /保护/);
  await assert.rejects(control.terminateProcess(101, true, 'codex.exe'), /保护/);
});

test('desktop control resolves a unique title or process name and rejects ambiguous matches', async () => {
  const control = new DesktopControl(probe);
  assert.equal(await control.focusByQuery('Jarvis'), true);
  assert.equal(await control.focusByQuery('chrome'), true);
  await assert.rejects(control.focusByQuery('notepad - other'), /没有找到窗口/);
  const ambiguous = new DesktopControl({ ...probe, listWindows: async () => [
    { id: 1, processName: 'chrome', title: '窗口 A' },
    { id: 2, processName: 'chrome', title: '窗口 B' },
  ] });
  await assert.rejects(ambiguous.focusByQuery('chrome'), /找到多个窗口/);
});

test('settings are restricted to fixed Windows destinations', async () => {
  const control = new DesktopControl(probe);
  assert.match(await control.openSettings('display'), /ms-settings:display/);
  await assert.rejects(control.openSettings('file:///C:/secret'), /不支持的系统设置/);
  await assert.rejects(control.openSettings('unknown'), /不支持的系统设置/);
});

test('desktop tools expose strict bounded schemas and delegate locally', async () => {
  const calls: string[] = [];
  const tools = new LocalTools({
    openUrl: async () => {}, openApp: async () => {},
    desktop: {
      listWindows: async () => { calls.push('list'); return probe.listWindows(); },
      focusByQuery: async query => { calls.push(`focus:${query}`); return new DesktopControl(probe).focusByQuery(query); },
      openSettings: async target => { calls.push(`settings:${target}`); return probe.openSettings(target); },
    },
  });
  for (const name of ['jarvis_list_windows', 'jarvis_focus_window', 'jarvis_open_system_settings']) {
    const spec = localToolSpecs.find((item: any) => item.name === name) as any;
    assert.ok(spec);
    assert.equal(spec.inputSchema.additionalProperties, false);
  }
  assert.equal((await tools.call('jarvis_list_windows', {})).success, true);
  assert.equal((await tools.call('jarvis_focus_window', { query: 'Jarvis' })).success, true);
  assert.equal((await tools.call('jarvis_open_system_settings', { target: 'display' })).success, true);
  assert.equal((await tools.call('jarvis_focus_window', { query: '' })).success, false);
  assert.equal((await tools.call('jarvis_open_system_settings', { target: 'file:///bad' })).success, false);
  assert.deepEqual(calls, ['list', 'focus:Jarvis', 'settings:display']);
});
