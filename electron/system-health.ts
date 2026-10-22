import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { cpus, totalmem, freemem } from 'node:os';

const execFileAsync = promisify(execFile);
const numberBetween = (value: number, min: number, max: number) => Number.isFinite(value) && value >= min && value <= max;

export type SystemHealthProcess = { name: string; pid: number; workingSetBytes: number; cpuTimeSeconds: number };
export type SystemHealthReport = {
  cpuPercent: number;
  memory: { totalBytes: number; availableBytes: number; usedPercent: number };
  disks: { name: string; totalBytes: number; freeBytes: number; usedPercent: number }[];
  startupItemCount: number;
  topProcesses: SystemHealthProcess[];
};
export type SystemHealthProbe = {
  sampleCpuPercent(): Promise<number>;
  readMemory(): { totalBytes: number; availableBytes: number };
  queryWindows(): Promise<{ disks: { name: string; totalBytes: number; freeBytes: number }[]; startupItemCount: number; topProcesses: SystemHealthProcess[] }>;
};

export async function collectSystemHealth(probe: SystemHealthProbe): Promise<SystemHealthReport> {
  const [cpuPercent, rawWindows] = await Promise.all([probe.sampleCpuPercent(), probe.queryWindows()]);
  const memory = probe.readMemory();
  if (!numberBetween(cpuPercent, 0, 100)) throw new Error('CPU 使用率数据无效');
  if (!Number.isSafeInteger(memory.totalBytes) || memory.totalBytes <= 0 || !Number.isSafeInteger(memory.availableBytes) || memory.availableBytes < 0 || memory.availableBytes > memory.totalBytes) throw new Error('内存数据无效');
  if (!Number.isSafeInteger(rawWindows.startupItemCount) || rawWindows.startupItemCount < 0) throw new Error('启动项数据无效');
  const disks = rawWindows.disks.map(disk => {
    if (!disk.name || !Number.isSafeInteger(disk.totalBytes) || disk.totalBytes <= 0 || !Number.isSafeInteger(disk.freeBytes) || disk.freeBytes < 0 || disk.freeBytes > disk.totalBytes) throw new Error('磁盘数据无效');
    return { ...disk, usedPercent: Math.round((disk.totalBytes - disk.freeBytes) / disk.totalBytes * 100) };
  });
  const topProcesses = rawWindows.topProcesses.slice(0, 5).map(item => {
    if (!item.name || !Number.isSafeInteger(item.pid) || item.pid < 0 || !Number.isFinite(item.workingSetBytes) || item.workingSetBytes < 0 || !Number.isFinite(item.cpuTimeSeconds) || item.cpuTimeSeconds < 0) throw new Error('进程数据无效');
    return { ...item, name: item.name.slice(0, 120) };
  });
  return {
    cpuPercent: Math.round(cpuPercent),
    memory: { ...memory, usedPercent: Math.round((memory.totalBytes - memory.availableBytes) / memory.totalBytes * 100) },
    disks,
    startupItemCount: rawWindows.startupItemCount,
    topProcesses,
  };
}

export function formatSystemHealth(report: SystemHealthReport): string {
  const gib = (bytes: number) => bytes < 1024 ** 2 ? `${Math.round(bytes)} B` : `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  const lines = [
    `电脑概况：CPU ${report.cpuPercent}%，内存 ${report.memory.usedPercent}%（已用 ${gib(report.memory.totalBytes - report.memory.availableBytes)} / ${gib(report.memory.totalBytes)}）`,
    ...report.disks.map(disk => `${disk.name} 磁盘已用 ${disk.usedPercent}%，剩余 ${gib(disk.freeBytes)}`),
    `启动项 ${report.startupItemCount} 个`,
    `高占用进程：${report.topProcesses.length ? report.topProcesses.map(item => `${item.name}（内存 ${gib(item.workingSetBytes)}，CPU 时间 ${item.cpuTimeSeconds.toFixed(0)} 秒）`).join('；') : '无'}`,
  ];
  return lines.join('\n');
}

function cpuTimes() {
  return cpus().map(cpu => ({
    total: Object.values(cpu.times).reduce((sum, time) => sum + time, 0),
    idle: cpu.times.idle,
  }));
}
function sampleCpuPercent(delayMs = 350): Promise<number> {
  const before = cpuTimes();
  return new Promise(resolve => setTimeout(() => {
    const after = cpuTimes();
    let total = 0;
    let idle = 0;
    for (let index = 0; index < Math.min(before.length, after.length); index++) {
      const elapsed = after[index]!.total - before[index]!.total;
      if (elapsed > 0) { total += elapsed; idle += after[index]!.idle - before[index]!.idle; }
    }
    resolve(total > 0 ? Math.max(0, Math.min(100, (1 - Math.max(0, idle) / total) * 100)) : 0);
  }, delayMs));
}

async function queryWindows(): Promise<Awaited<ReturnType<SystemHealthProbe['queryWindows']>>> {
  if (process.platform !== 'win32') throw new Error('电脑健康检测目前仅支持 Windows');
  const script = [
    '$ErrorActionPreference = "Stop"',
    '$disks = @(Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" | ForEach-Object { [pscustomobject]@{ name=$_.DeviceID; totalBytes=[double]$_.Size; freeBytes=[double]$_.FreeSpace } })',
    '$startup = @(Get-CimInstance Win32_StartupCommand).Count',
    '$processes = @(Get-Process | Sort-Object WorkingSet64 -Descending | Select-Object -First 5 | ForEach-Object { [pscustomobject]@{ name=$_.ProcessName; pid=$_.Id; workingSetBytes=[double]$_.WorkingSet64; cpuTimeSeconds=[double]$_.CPU } })',
    '[pscustomobject]@{ disks=$disks; startupItemCount=$startup; topProcesses=$processes } | ConvertTo-Json -Depth 5 -Compress',
  ].join('; ');
  const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], { windowsHide: true, timeout: 8000, maxBuffer: 256 * 1024 });
  const parsed = JSON.parse(stdout.trim());
  return {
    disks: Array.isArray(parsed.disks) ? parsed.disks : parsed.disks ? [parsed.disks] : [],
    startupItemCount: parsed.startupItemCount,
    topProcesses: Array.isArray(parsed.topProcesses) ? parsed.topProcesses : parsed.topProcesses ? [parsed.topProcesses] : [],
  };
}

export function readSystemHealth(): Promise<SystemHealthReport> {
  return collectSystemHealth({
    sampleCpuPercent,
    readMemory: () => ({ totalBytes: totalmem(), availableBytes: freemem() }),
    queryWindows,
  });
}
