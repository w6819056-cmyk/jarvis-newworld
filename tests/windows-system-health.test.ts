import assert from 'node:assert/strict';
import test from 'node:test';
import { collectSystemHealth, formatSystemHealth, type SystemHealthProbe } from '../electron/system-health.ts';
import { LocalTools, localToolSpecs } from '../electron/local-tools.ts';

const probe: SystemHealthProbe = {
  sampleCpuPercent: async () => 23.4,
  readMemory: () => ({ totalBytes: 16_000, availableBytes: 4_000 }),
  queryWindows: async () => ({
    disks: [{ name: 'C:', totalBytes: 1_000, freeBytes: 250 }],
    startupItemCount: 4,
    topProcesses: [{ name: 'Browser', pid: 42, workingSetBytes: 512, cpuTimeSeconds: 18 }],
  }),
};

test('system health aggregates bounded read-only metrics and formats a concise report', async () => {
  const report = await collectSystemHealth(probe);
  assert.deepEqual(report, {
    cpuPercent: 23,
    memory: { totalBytes: 16_000, availableBytes: 4_000, usedPercent: 75 },
    disks: [{ name: 'C:', totalBytes: 1_000, freeBytes: 250, usedPercent: 75 }],
    startupItemCount: 4,
    topProcesses: [{ name: 'Browser', pid: 42, workingSetBytes: 512, cpuTimeSeconds: 18 }],
  });
  assert.match(formatSystemHealth(report), /CPU 23%/);
  assert.match(formatSystemHealth(report), /内存 75%/);
  assert.match(formatSystemHealth(report), /C: 磁盘已用 75%，剩余 250 B/);
  assert.match(formatSystemHealth(report), /启动项 4 个/);
  assert.match(formatSystemHealth(report), /Browser/);
});

test('system health rejects invalid provider measurements instead of reporting fabricated values', async () => {
  await assert.rejects(collectSystemHealth({
    ...probe,
    sampleCpuPercent: async () => 120,
  }), /CPU 使用率数据无效/);
  await assert.rejects(collectSystemHealth({
    ...probe,
    readMemory: () => ({ totalBytes: 100, availableBytes: 101 }),
  }), /内存数据无效/);
  await assert.rejects(collectSystemHealth({
    ...probe,
    queryWindows: async () => ({ disks: [], startupItemCount: -1, topProcesses: [] }),
  }), /启动项数据无效/);
});

test('system health tool is read-only, takes no arguments, and returns a compact report', async () => {
  let calls = 0;
  const tools = new LocalTools({
    openUrl: async () => {},
    openApp: async () => {},
    getSystemHealth: async () => { calls++; return collectSystemHealth(probe); },
  });
  const spec = localToolSpecs.find((item: any) => item.name === 'jarvis_get_system_health') as any;
  assert.ok(spec);
  assert.deepEqual(spec.inputSchema, { type: 'object', properties: {}, additionalProperties: false });
  const result = await tools.call('jarvis_get_system_health', {});
  assert.equal(result.success, true);
  assert.match(result.contentItems[0]!.text, /CPU 23%/);
  assert.equal(calls, 1);
  assert.equal((await tools.call('jarvis_get_system_health', { processName: 'Browser' })).success, false);
  assert.equal(calls, 1);
});

test('system health tool surfaces collection errors without masking them as a healthy report', async () => {
  const tools = new LocalTools({
    openUrl: async () => {},
    openApp: async () => {},
    getSystemHealth: async () => { throw new Error('系统信息采集超时'); },
  });
  const result = await tools.call('jarvis_get_system_health', {});
  assert.equal(result.success, false);
  assert.match(result.contentItems[0]!.text, /系统信息采集超时/);
});
