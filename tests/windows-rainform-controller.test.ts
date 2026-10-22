import assert from 'node:assert/strict';
import test from 'node:test';
import { RainformController, type RainformWindowHost } from '../modules/rainform/control.js';
import type { RainformCommandEnvelope, RainformResponseEnvelope, RainformWeatherUpdate } from '../modules/rainform/protocol.js';

class FakeHost implements RainformWindowHost {
  commands: RainformCommandEnvelope[] = [];
  handlers = new Set<(trusted: boolean, response: RainformResponseEnvelope) => void>();
  closed = new Set<() => void>();
  opened = 0;
  open(): Promise<void> { this.opened++; return Promise.resolve(); }
  focus(): void {}
  send(command: RainformCommandEnvelope): void { this.commands.push(command); }
  onResult(handler: (trusted: boolean, response: RainformResponseEnvelope) => void): () => void { this.handlers.add(handler); return () => this.handlers.delete(handler); }
  onClosed(handler: () => void): () => void { this.closed.add(handler); return () => this.closed.delete(handler); }
  reply(value: RainformResponseEnvelope, trusted = true): void { for (const handler of this.handlers) handler(trusted, value); }
  close(): void { for (const handler of this.closed) handler(); }
}

function update(): RainformWeatherUpdate {
  return {
    city: { id: '101180101', name: '郑州', adm1: '河南省', latitude: 34.75, longitude: 113.63 },
    current: { condition: '小雨', iconCode: 305, precipitationMm: 1.2, observedAt: '2026-10-22T10:00+08:00' },
    forecast: { values: Array(25).fill(0), labels: Array.from({ length: 25 }, (_, index) => `${String(index).padStart(2, '0')}:00`), updatedAt: '2026-10-22T10:00+08:00' },
  };
}

test('Rainform controller validates and correlates a bounded city/weather update', async () => {
  const host = new FakeHost();
  const controller = new RainformController(host, { timeoutMs: 50 });
  const pending = controller.setCity(update());
  await new Promise(resolve => setImmediate(resolve));
  const command = host.commands[0]!;
  assert.equal(command.type, 'setCity');
  host.reply({ id: command.id, success: true });
  await pending;
  assert.equal(host.opened, 1);
  assert.equal(controller.pendingCount, 0);
  controller.dispose();
});

test('Rainform controller rejects invalid rainfall curves and untrusted renderer replies', async () => {
  const host = new FakeHost();
  const controller = new RainformController(host, { timeoutMs: 50 });
  await assert.rejects(controller.setCity({ ...update(), forecast: { ...update().forecast, values: [NaN] } }), /预报/);
  await assert.rejects(controller.setCity({ ...update(), unexpected: true } as RainformWeatherUpdate), /城市信息无效/);
  const pending = controller.setCity(update());
  await new Promise(resolve => setImmediate(resolve));
  host.reply({ id: host.commands[0]!.id, success: true }, false);
  await assert.rejects(pending, /无效/);
  controller.dispose();
});

test('Rainform controller rejects pending requests on window close', async () => {
  const host = new FakeHost();
  const controller = new RainformController(host, { timeoutMs: 50 });
  const pending = controller.setCity(update());
  await new Promise(resolve => setImmediate(resolve));
  host.close();
  await assert.rejects(pending, /关闭/);
  controller.dispose();
});
