import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
export function resolveInstalledApp(name: string, readShortcut: (file: string) => { target: string }): string {
  const isExe = (file: string) => path.extname(file).toLowerCase() === '.exe' && existsSync(file) && statSync(file).isFile();
  if (path.isAbsolute(name)) {
    if (!isExe(name)) throw new Error('应用位置必须是已存在的 exe 文件');
    return name;
  }
  const aliases: Record<string, string> = { '记事本': 'notepad', '计算器': 'calc', '画图': 'mspaint', '文件资源管理器': 'explorer', '浏览器': 'msedge' };
  const executable = aliases[name] ?? name.replace(/\.exe$/i, '');
  if (/[/\\]/.test(executable)) throw new Error('请提供应用名称或完整 exe 路径');
  for (const folder of (process.env.PATH ?? '').split(path.delimiter)) {
    const candidate = path.join(folder, `${executable}.exe`);
    try { if (isExe(candidate)) return candidate; } catch { /* unreadable alias */ }
  }
  const roots = [path.join(process.env.APPDATA ?? '', 'Microsoft/Windows/Start Menu/Programs'), path.join(process.env.ProgramData ?? '', 'Microsoft/Windows/Start Menu/Programs')];
  const shortcuts: { name: string; file: string }[] = [];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    try { for (const file of readdirSync(root, { recursive: true, withFileTypes: true })) {
      if (file.isFile() && /\.lnk$/i.test(file.name)) shortcuts.push({ name: file.name.slice(0, -4), file: path.join(file.parentPath, file.name) });
    } } catch { /* unavailable start-menu entries are skipped */ }
  }
  const exact = shortcuts.filter(s => s.name.toLowerCase() === name.toLowerCase());
  const matches = exact.length ? exact : shortcuts.filter(s => s.name.toLowerCase().includes(name.toLowerCase()));
  if (matches.length > 1) throw new Error(`找到多个应用，请说明具体名称：${matches.slice(0, 8).map(s => s.name).join('、')}`);
  if (matches.length === 1) {
    const target = readShortcut(matches[0].file).target;
    if (isExe(target)) return target;
    throw new Error('该快捷方式不是普通 exe 应用，请通过 Codex 进一步处理');
  }
  throw new Error('未找到该应用，请提供准确名称或 exe 完整路径');
}
