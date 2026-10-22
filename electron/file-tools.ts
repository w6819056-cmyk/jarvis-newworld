import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
export type DuplicateGroup = { sizeBytes: number; files: string[] };
export type DuplicateScanResult = { scannedDirectories: string[]; groups: DuplicateGroup[]; duplicateFileCount: number };
export type DuplicateScannerProbe = {
  exists(value: string): boolean;
  run(args: string[]): Promise<{ exitCode: number; stdout: string; output: string }>;
};

export function parseCzkawkaDuplicates(raw: string, maxGroups = 100): DuplicateGroup[] {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new Error('Czkawka 返回的重复文件数据格式无效'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Czkawka 返回的重复文件数据格式无效');
  const groups: DuplicateGroup[] = [];
  for (const [sizeKey, value] of Object.entries(parsed)) {
    const sizeBytes = Number(sizeKey);
    if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 0 || !Array.isArray(value)) continue;
    for (const rawGroup of value) {
      if (!Array.isArray(rawGroup)) continue;
      const files = rawGroup.map((item: any) => item && typeof item.path === 'string' ? item.path : '').filter(Boolean).slice(0, 100);
      if (files.length >= 2) groups.push({ sizeBytes, files });
      if (groups.length >= maxGroups) return groups;
    }
  }
  return groups;
}

export class DuplicateScanner {
  constructor(private readonly probe: DuplicateScannerProbe) {}
  async scan(directories: string[]): Promise<DuplicateScanResult> {
    if (!Array.isArray(directories) || directories.length < 1 || directories.length > 8) throw new Error('请指定 1 到 8 个扫描目录');
    const normalized = [...new Set(directories.map(value => {
      if (typeof value !== 'string' || !value.trim() || !path.isAbsolute(value)) throw new Error('扫描目录必须是绝对路径');
      const resolved = path.resolve(value.trim());
      if (!this.probe.exists(resolved)) throw new Error(`扫描目录不存在：${resolved}`);
      return resolved;
    }))];
    const args = ['dup', '--directories', ...normalized, '--compact-file-to-save', '-', '--minimal-file-size', '1', '--disable-cache', '--do-not-print-results'];
    const result = await this.probe.run(args);
    if (result.exitCode !== 0 && result.exitCode !== 11) throw new Error(result.output.trim().slice(-1200) || `重复文件扫描失败（退出码 ${result.exitCode}）`);
    const groups = parseCzkawkaDuplicates(result.stdout, 50);
    return { scannedDirectories: normalized, groups, duplicateFileCount: groups.reduce((sum, group) => sum + group.files.length, 0) };
  }
}

async function runCzkawka(args: string[]) {
  if (process.platform !== 'win32') throw new Error('重复文件扫描目前仅支持 Windows');
  const packagedExecutable = process.resourcesPath ? path.join(process.resourcesPath, 'czkawka', 'czkawka.exe') : '';
  const executable = packagedExecutable && existsSync(packagedExecutable) ? packagedExecutable : path.resolve('runtime/tools/czkawka/windows_czkawka_cli.exe');
  if (!existsSync(executable)) throw new Error('Czkawka 扫描器未随安装包安装');
  const temp = await mkdtemp(path.join(os.tmpdir(), 'jarvis-czkawka-'));
  const outputPath = path.join(temp, 'duplicates.json');
  const commandArgs = args.map(value => value === '-' ? outputPath : value);
  try {
    const result = await execFileAsync(executable, commandArgs, { windowsHide: true, timeout: 120_000, maxBuffer: 2 * 1024 * 1024 });
    return { exitCode: 0, stdout: await readFile(outputPath, 'utf8').catch(() => '{}'), output: result.stdout };
  } catch (error: any) {
    const exitCode = Number(error?.code);
    return { exitCode, stdout: await readFile(outputPath, 'utf8').catch(() => '{}'), output: `${String(error?.stdout ?? '')}\n${String(error?.stderr ?? '')}` };
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

export function createDuplicateScanner() {
  return new DuplicateScanner({ exists: existsSync, run: runCzkawka });
}

export function formatDuplicateScan(result: DuplicateScanResult): string {
  if (!result.groups.length) return `扫描完成：${result.scannedDirectories.join('、')}，未发现重复文件。`;
  const lines = [`扫描完成：发现 ${result.groups.length} 组重复文件，共 ${result.duplicateFileCount} 个文件。`];
  for (const [index, group] of result.groups.entries()) {
    lines.push(`${index + 1}. ${group.sizeBytes} 字节：${group.files.join('；')}`);
  }
  lines.push('本次仅扫描和预览，没有移动或删除文件。');
  return lines.join('\n');
}
