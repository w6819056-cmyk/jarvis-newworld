import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync, spawn } from 'node:child_process';
import path from 'node:path';
import { UiAutomationSession } from '../electron/ui-automation.ts';
import { createPowerShellUiAutomationProbe } from '../electron/ui-automation-process.ts';

test('Notepad foreground UI Automation pilot', { skip: process.env.JARVIS_UIA_NOTEPAD !== '1' }, async context => {
  const existing = Number(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '@(Get-Process -Name notepad -ErrorAction SilentlyContinue).Count'], { encoding: 'utf8', windowsHide: true }).trim());
  if (existing > 0) { context.skip('An existing Notepad instance is open; refusing to interact with it'); return; }
  const owned = spawn('notepad.exe', [], { windowsHide: false, stdio: 'ignore' });
  const session = new UiAutomationSession(createPowerShellUiAutomationProbe(path.resolve('electron/windows-ui-automation.ps1')));
  let ownedWindowPid: number | undefined;
  try {
    const deadline = Date.now() + 15_000;
    let inspection;
    do {
      inspection = await session.inspect();
      if (/notepad/i.test(inspection.foreground.processName)) {
        const pid = inspection.foreground.processId;
        const parentPid = pid === owned.pid ? owned.pid : Number(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `$p=Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}"; if ($p) { $p.ParentProcessId }`], { encoding: 'utf8', windowsHide: true }).trim());
        if (pid === owned.pid || parentPid === owned.pid) {
          ownedWindowPid = pid;
          if (inspection.controls.some(control => control.role === 'Document' || control.role === 'Edit')) break;
        }
      }
      await new Promise(resolve => setTimeout(resolve, 250));
    } while (Date.now() < deadline);
    assert.ok(ownedWindowPid, 'a Notepad foreground process must belong to the process launched by this test');
    const editor = inspection!.controls.find(control => control.role === 'Edit' && control.patterns.includes('setValue'));
    assert.ok(inspection!.controls.some(control => control.role === 'Document' || control.role === 'Edit'), `Notepad control tree unavailable: ${JSON.stringify(inspection!.controls.map(({ role, patterns }) => ({ role, patterns })))}`);
    if (!editor) return;
    const text = Array.from({ length: 100 }, (_, index) => `Jarvis UI Automation test line ${index + 1}`).join('\n');
    const result = await session.act({ controlId: editor!.id, action: { type: 'setValue', text } });
    assert.equal(result.success, true, result.error ?? 'action failed');
    assert.equal(result.state, `valueLength:${text.length}`);
  } finally {
    if (ownedWindowPid && ownedWindowPid !== owned.pid) {
      try { process.kill(ownedWindowPid); } catch {}
    }
    if (owned.pid && !owned.killed) owned.kill();
  }
});
