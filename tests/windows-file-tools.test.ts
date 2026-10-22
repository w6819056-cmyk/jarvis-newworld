import assert from 'node:assert/strict';
import test from 'node:test';
import { DuplicateScanner, parseCzkawkaDuplicates, type DuplicateScannerProbe } from '../electron/file-tools.ts';
import { LocalTools, localToolSpecs } from '../electron/local-tools.ts';
import { readFileSync } from 'node:fs';

const json = JSON.stringify({ '28': [[
  { path: 'C:\\Users\\test\\Desktop\\a.txt', size: 28, hash: 'abc' },
  { path: 'C:\\Users\\test\\Desktop\\copy.txt', size: 28, hash: 'abc' },
]] });

test('duplicate parser converts Czkawka compact JSON into bounded duplicate groups', () => {
  assert.deepEqual(parseCzkawkaDuplicates(json, 10), [{
    sizeBytes: 28,
    files: ['C:\\Users\\test\\Desktop\\a.txt', 'C:\\Users\\test\\Desktop\\copy.txt'],
  }]);
  assert.deepEqual(parseCzkawkaDuplicates('{"bad":[]}', 10), []);
});

test('duplicate scanner validates directories and accepts exit code 11 when duplicates exist', async () => {
  const calls: string[][] = [];
  const probe: DuplicateScannerProbe = {
    exists: value => value === 'C:\\Users\\test\\Desktop',
    run: async args => { calls.push(args); return { exitCode: 11, stdout: json, output: '' }; },
  };
  const scanner = new DuplicateScanner(probe);
  const result = await scanner.scan(['C:\\Users\\test\\Desktop']);
  assert.equal(result.groups.length, 1);
  assert.equal(calls[0]!.includes('--do-not-print-results'), true);
  await assert.rejects(scanner.scan(['relative']), /绝对路径/);
  await assert.rejects(scanner.scan(['C:\\missing']), /不存在/);
});

test('duplicate scan tool is read-only, bounded, and rejects extra paths fields', async () => {
  const tools = new LocalTools({
    openUrl: async () => {}, openApp: async () => {},
    findDuplicates: async paths => ({ groups: [{ sizeBytes: 10, files: paths.map(item => `${item}\\copy`) }], scannedDirectories: paths, duplicateFileCount: paths.length }),
  });
  const spec = localToolSpecs.find((item: any) => item.name === 'jarvis_find_duplicate_files') as any;
  assert.ok(spec);
  assert.equal(spec.inputSchema.additionalProperties, false);
  const result = await tools.call('jarvis_find_duplicate_files', { directories: ['C:\\Users\\test\\Desktop'] });
  assert.equal(result.success, true);
  assert.match(result.contentItems[0]!.text, /copy/);
  assert.equal((await tools.call('jarvis_find_duplicate_files', { directories: ['relative'] })).success, false);
  assert.equal((await tools.call('jarvis_find_duplicate_files', { directories: [], extra: true })).success, false);
});

test('Windows package includes only the fixed Czkawka CLI with its own license and hash check', () => {
  const builder = readFileSync(new URL('../electron-builder.yml', import.meta.url), 'utf8');
  const script = readFileSync(new URL('../scripts/build-windows.mjs', import.meta.url), 'utf8');
  assert.match(builder, /windows_czkawka_cli\.exe/);
  assert.match(builder, /CZKAWKA-CLI-MIT\.txt/);
  assert.match(script, /EB7C2009D2DD49CF5202ACBD65370CAECE0A3F819B9515E727CEDB1EC088ED1A/);
  assert.doesNotMatch(builder, /czkawka_gui|krokiet/i);
});
