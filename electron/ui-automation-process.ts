import { spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import type { UiAction, UiAutomationProbe, UiForeground, UiProbeControl } from './ui-automation';

type PowerShellResponse = { ok: boolean; error?: string; foreground?: UiForeground; controls?: UiProbeControl[]; verified?: boolean; state?: string };
type Runner = (scriptPath: string, request: unknown) => Promise<PowerShellResponse>;

export function createPowerShellUiAutomationProbe(scriptPath: string, runner: Runner = runPowerShell): UiAutomationProbe {
  return {
    inspect: async () => {
      const response = await runner(scriptPath, { operation: 'inspect' });
      if (!response.ok || !response.foreground || !Array.isArray(response.controls)) throw new Error(response.error ?? '无法读取前台窗口控件');
      return { foreground: response.foreground, controls: response.controls.slice(0, 200) };
    },
    perform: async ({ foregroundHandle, runtimeId, action }) => {
      const response = await runner(scriptPath, { operation: 'act', foregroundHandle, runtimeId, action: serializeAction(action) });
      if (!response.ok || !response.foreground || typeof response.verified !== 'boolean') throw new Error(response.error ?? 'UI Automation 操作失败');
      return { foregroundHandle: response.foreground.handle, verified: response.verified, state: String(response.state ?? '').slice(0, 120) };
    },
  };
}

function serializeAction(action: UiAction) {
  switch (action.type) {
    case 'invoke': return { type: 'invoke' };
    case 'setValue': return { type: 'setValue', text: action.text };
    case 'select': return { type: 'select' };
    case 'scroll': return { type: 'scroll', direction: action.direction, amount: action.amount };
  }
}

function runPowerShell(scriptPath: string, request: unknown): Promise<PowerShellResponse> {
  if (process.platform !== 'win32') return Promise.reject(new Error('Windows UI Automation 仅支持 Windows'));
  return new Promise((resolve, reject) => {
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath], {
        windowsHide: true,
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (error) {
      reject(error);
      return;
    }
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (error?: Error, result?: PowerShellResponse) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) reject(error); else resolve(result!);
    };
    const timeout = setTimeout(() => {
      child.kill();
      finish(new Error('Windows UI Automation 超时'));
    }, 5000);
    child.stdout.setEncoding('utf8').on('data', chunk => {
      stdout += chunk;
      if (stdout.length > 1_000_000) { child.kill(); finish(new Error('UI Automation 响应超过大小限制')); }
    });
    child.stderr.setEncoding('utf8').on('data', chunk => { stderr = (stderr + chunk).slice(-4000); });
    child.once('error', error => finish(new Error(`无法启动 Windows UI Automation：${error.message}`)));
    child.once('close', code => {
      try {
        const response = JSON.parse(stdout.trim()) as PowerShellResponse;
        if (!response.ok) finish(new Error(String(response.error ?? (stderr || `UI Automation 退出码 ${code}`))));
        else finish(undefined, response);
      } catch (error) {
        finish(new Error(`Windows UI Automation 返回无效数据：${stderr || (error as Error).message}`));
      }
    });
    child.stdin.end(JSON.stringify(request));
  });
}
