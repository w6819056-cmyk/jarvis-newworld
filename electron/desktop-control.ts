import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
export type DesktopWindow = { id: number; processName: string; title: string };
export type DesktopControlProbe = {
  listWindows(): Promise<DesktopWindow[]>;
  focusWindow(id: number): Promise<boolean>;
  openSettings(uri: string): Promise<string>;
  getVolume(): Promise<{ percent: number; muted: boolean }>;
  setVolume(percent: number): Promise<{ percent: number; muted: boolean }>;
  setMuted(muted: boolean): Promise<{ percent: number; muted: boolean }>;
  listProcesses(): Promise<DesktopProcess[]>;
  terminateProcess(pid: number, confirmed: boolean, processName?: string): Promise<boolean>;
};
export type DesktopProcess = { pid: number; name: string; workingSetBytes: number; cpuPercent: number };

const SETTINGS: Record<string, string> = {
  bluetooth: 'ms-settings:bluetooth',
  display: 'ms-settings:display',
  sound: 'ms-settings:sound',
  network: 'ms-settings:network',
  apps: 'ms-settings:appsfeatures',
  startup: 'ms-settings:startupapps',
};

export class DesktopControl {
  constructor(private readonly probe: DesktopControlProbe) {}
  async listWindows() {
    const windows = await this.probe.listWindows();
    return windows.filter(item => Number.isSafeInteger(item.id) && item.id > 0 && item.title.trim()).slice(0, 100);
  }
  async focusWindow(id: number) {
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error('窗口编号无效');
    return this.probe.focusWindow(id);
  }
  async focusByQuery(query: string) {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) throw new Error('窗口名称不能为空');
    const matches = (await this.listWindows()).filter(item => item.title.toLocaleLowerCase().includes(needle) || item.processName.toLocaleLowerCase() === needle);
    if (!matches.length) throw new Error(`没有找到窗口：${query}`);
    if (matches.length > 1) throw new Error(`找到多个窗口，请说出更具体的名称：${matches.slice(0, 5).map(item => item.title).join('、')}`);
    if (!await this.focusWindow(matches[0]!.id)) throw new Error('窗口无法聚焦，可能已关闭或权限不足');
    return true;
  }
  async openSettings(target: string) {
    const uri = SETTINGS[target.trim().toLocaleLowerCase()];
    if (!uri) throw new Error(`不支持的系统设置：${target}`);
    return this.probe.openSettings(uri);
  }
  getVolume() { return this.probe.getVolume(); }
  async setVolume(percent: number) {
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) throw new Error('音量范围必须是 0 到 100');
    return this.probe.setVolume(Math.round(percent));
  }
  async setMuted(muted: boolean) {
    if (typeof muted !== 'boolean') throw new Error('静音状态无效');
    return this.probe.setMuted(muted);
  }
  async listProcesses() {
    const processes = await this.probe.listProcesses();
    return processes.filter(item => Number.isSafeInteger(item.pid) && item.pid > 0 && item.name).slice(0, 100);
  }
  async terminateProcess(pid: number, confirmed: boolean, processName = '') {
    if (!confirmed) throw new Error('结束进程前需要明确确认');
    if (!Number.isSafeInteger(pid) || pid <= 4) throw new Error('系统进程受保护，不能结束');
    if (/^(jarvis|codex)(\.exe)?$/i.test(processName.trim())) throw new Error('Jarvis 和 Codex 进程受保护，不能结束');
    return this.probe.terminateProcess(pid, true, processName);
  }
}

async function powershellJson(script: string): Promise<unknown> {
  if (process.platform !== 'win32') throw new Error('桌面控制目前仅支持 Windows');
  const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], { windowsHide: true, timeout: 8000, maxBuffer: 512 * 1024 });
  return JSON.parse(stdout.trim() || 'null');
}

async function listWindows(): Promise<DesktopWindow[]> {
  const value = await powershellJson('Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle } | Select-Object @{n="id";e={[int64]$_.MainWindowHandle}}, @{n="processName";e={$_.ProcessName}}, @{n="title";e={$_.MainWindowTitle}} | ConvertTo-Json -Depth 3 -Compress');
  const records = Array.isArray(value) ? value : value ? [value] : [];
  return records.map(item => ({ id: Number(item.id), processName: String(item.processName ?? ''), title: String(item.title ?? '') }));
}

async function focusWindow(id: number): Promise<boolean> {
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('窗口编号无效');
  const script = `$signature='[DllImport("user32.dll")] public static extern bool SetForegroundWindow(System.IntPtr hWnd);'; Add-Type -MemberDefinition $signature -Name NativeMethods -Namespace Jarvis; [Jarvis.NativeMethods]::SetForegroundWindow([IntPtr]${id}) | ConvertTo-Json`;
  return Boolean(await powershellJson(script));
}

async function openSettings(uri: string): Promise<string> {
  if (!Object.values(SETTINGS).includes(uri)) throw new Error('不支持的系统设置');
  await execFileAsync('explorer.exe', [uri], { windowsHide: true, timeout: 8000 });
  return `已打开 ${uri}`;
}

const AUDIO_CS = `using System; using System.Runtime.InteropServices; public static class JarvisAudio { [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumerator {} [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface IMMDeviceEnumerator { int EnumAudioEndpoints(int dataFlow, int stateMask, out IntPtr devices); int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice device); } [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface IMMDevice { int Activate(ref Guid iid, int clsCtx, IntPtr activationParams, out IAudioEndpointVolume volume); } [ComImport, Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface IAudioEndpointVolume { int RegisterControlChangeNotify(IntPtr notify); int UnregisterControlChangeNotify(IntPtr notify); int GetChannelCount(out int count); int SetMasterVolumeLevel(float level, Guid context); int SetMasterVolumeLevelScalar(float level, Guid context); int GetMasterVolumeLevel(out float level); int GetMasterVolumeLevelScalar(out float level); int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, Guid context); int GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute); } public static string Get(){ var e=(IMMDeviceEnumerator)new MMDeviceEnumerator(); IMMDevice d; e.GetDefaultAudioEndpoint(0,1,out d); var iid=typeof(IAudioEndpointVolume).GUID; IAudioEndpointVolume v; d.Activate(ref iid,23,IntPtr.Zero,out v); float p; bool m; v.GetMasterVolumeLevelScalar(out p); v.GetMute(out m); return string.Format("{{\\"percent\\":{0},\\"muted\\":{1}}}", Math.Round(p*100), m.ToString().ToLower()); } public static string Set(float p, bool m, bool changeMute){ var e=(IMMDeviceEnumerator)new MMDeviceEnumerator(); IMMDevice d; e.GetDefaultAudioEndpoint(0,1,out d); var iid=typeof(IAudioEndpointVolume).GUID; IAudioEndpointVolume v; d.Activate(ref iid,23,IntPtr.Zero,out v); if(p>=0) v.SetMasterVolumeLevelScalar(p,Guid.Empty); if(changeMute) v.SetMute(m,Guid.Empty); return Get(); } }`;
async function getVolume(): Promise<{ percent: number; muted: boolean }> {
  const script = `Add-Type -TypeDefinition @'\n${AUDIO_CS}\n'@; [JarvisAudio]::Get() | ConvertFrom-Json | ConvertTo-Json -Compress`;
  const value = await powershellJson(script);
  return { percent: Number((value as any)?.percent ?? 50), muted: Boolean((value as any)?.muted) };
}
async function setVolume(percent: number): Promise<{ percent: number; muted: boolean }> {
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) throw new Error('音量范围必须是 0 到 100');
  const script = `Add-Type -TypeDefinition @'\n${AUDIO_CS}\n'@; [JarvisAudio]::Set(${Math.round(percent) / 100}, $false, $false) | ConvertFrom-Json | ConvertTo-Json -Compress`;
  return JSON.parse(String(await powershellJson(script)));
}
async function setMuted(muted: boolean): Promise<{ percent: number; muted: boolean }> {
  const script = `Add-Type -TypeDefinition @'\n${AUDIO_CS}\n'@; [JarvisAudio]::Set(-1, ${muted ? '$true' : '$false'}, $true) | ConvertFrom-Json | ConvertTo-Json -Compress`;
  return JSON.parse(String(await powershellJson(script)));
}
async function listProcesses(): Promise<DesktopProcess[]> {
  const value = await powershellJson('Get-Process | Sort-Object WorkingSet64 -Descending | Select-Object -First 100 @{n="pid";e={$_.Id}}, @{n="name";e={$_.ProcessName}}, @{n="workingSetBytes";e={[double]$_.WorkingSet64}}, @{n="cpuPercent";e={0}} | ConvertTo-Json -Depth 3 -Compress');
  const records = Array.isArray(value) ? value : value ? [value] : [];
  return records.map(item => ({ pid: Number(item.pid), name: String(item.name ?? ''), workingSetBytes: Number(item.workingSetBytes ?? 0), cpuPercent: Number(item.cpuPercent ?? 0) }));
}
async function terminateProcess(pid: number, confirmed: boolean, processName = ''): Promise<boolean> {
  if (!confirmed) throw new Error('结束进程前需要明确确认');
  if (!Number.isSafeInteger(pid) || pid <= 4 || /^(jarvis|codex)(\.exe)?$/i.test(processName.trim())) throw new Error('该进程受保护，不能结束');
  await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', `Stop-Process -Id ${pid} -Force -ErrorAction Stop`], { windowsHide: true, timeout: 8000 });
  return true;
}

export function createWindowsDesktopControl() {
  return new DesktopControl({ listWindows, focusWindow, openSettings, getVolume, setVolume, setMuted, listProcesses, terminateProcess });
}
