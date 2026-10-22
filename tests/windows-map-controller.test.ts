import assert from 'node:assert/strict';
import test from 'node:test';
import { HoloMapController, type MapWindowHost } from '../modules/holo-map/controller.ts';
import { createPlannedRouteResult, type MapCommand, type MapCommandEnvelope, type MapResponseEnvelope } from '../modules/holo-map/protocol.ts';

test('successful renderer route summaries use the controller planned-result contract', () => {
  assert.deepEqual(createPlannedRouteResult({
    origin: '我的位置', destination: '郑州东站', mode: 'drive', distanceMeters: 8500, durationSeconds: 1200,
  }), {
    status: 'planned', origin: '我的位置', destination: '郑州东站', mode: 'drive', distanceMeters: 8500, durationSeconds: 1200,
  });
});

class FakeMapWindow implements MapWindowHost {
  commands: MapCommandEnvelope[] = [];
  private resultHandler?: (trusted: boolean, response: MapResponseEnvelope) => void;
  private closedHandler?: () => void;
  focused = 0;
  opened = 0;
  onResult(handler: (trusted: boolean, response: MapResponseEnvelope) => void): () => void { this.resultHandler = handler; return () => { this.resultHandler = undefined; }; }
  onClosed(handler: () => void): () => void { this.closedHandler = handler; return () => { this.closedHandler = undefined; }; }
  async open(): Promise<void> { this.opened++; }
  focus(): void { this.focused++; }
  send(command: MapCommandEnvelope): void { this.commands.push(command); }
  complete(response: MapResponseEnvelope, trusted = true): void { this.resultHandler?.(trusted, response); }
  close(): void { this.closedHandler?.(); }
}

test('map controller reuses its Jarvis-owned window and correlates command results', async () => {
  const host = new FakeMapWindow();
  const controller = new HoloMapController(host, { timeoutMs: 100 });
  const command: MapCommand = { type: 'searchNearby', payload: { category: '美食' } };
  const pending = controller.searchNearby(command.payload);
  await new Promise(resolve => setImmediate(resolve));
  const envelope = host.commands[0]!;
  host.complete({ id: envelope.id, success: true, result: { places: [{ name: '测试餐馆', address: '测试路', distanceMeters: 20 }] } });

  assert.deepEqual(await pending, { places: [{ name: '测试餐馆', address: '测试路', distanceMeters: 20 }] });
  assert.equal(host.opened, 1);
  assert.equal(host.focused, 1);
});

test('map controller returns only validated real device coordinates', async () => {
  const host = new FakeMapWindow();
  const controller = new HoloMapController(host, { timeoutMs: 100 });
  const pending = controller.getCurrentLocation();
  await new Promise(resolve => setImmediate(resolve));
  const envelope = host.commands[0]!;
  assert.deepEqual(envelope, { type: 'getCurrentLocation', payload: {}, id: envelope.id });
  host.complete({ id: envelope.id, success: true, result: { latitude: 34.75, longitude: 113.63, address: '河南省郑州市' } });
  assert.deepEqual(await pending, { latitude: 34.75, longitude: 113.63, address: '河南省郑州市' });
});

test('map controller rejects invalid device coordinates and does not substitute a fallback', async () => {
  const host = new FakeMapWindow();
  const controller = new HoloMapController(host, { timeoutMs: 100 });
  const pending = controller.getCurrentLocation();
  await new Promise(resolve => setImmediate(resolve));
  host.complete({ id: host.commands[0]!.id, success: true, result: { latitude: 500, longitude: 113.63, address: '河南省郑州市' } });
  await assert.rejects(pending, /位置坐标/);
});

test('map controller rejects results from untrusted windows and times out cleanly', async () => {
  const host = new FakeMapWindow();
  const controller = new HoloMapController(host, { timeoutMs: 20 });
  const pending = controller.searchNearby({ category: '美食' });
  await new Promise(resolve => setImmediate(resolve));
  host.complete({ id: host.commands[0]!.id, success: true, result: { places: [] } }, false);

  await assert.rejects(pending, /地图窗口消息无效|超时/);
  assert.equal(controller.pendingCount, 0);
});

test('map controller rejects pending operations when its window closes', async () => {
  const host = new FakeMapWindow();
  const controller = new HoloMapController(host, { timeoutMs: 100 });
  const pending = controller.planRoute({ destination: '郑州东站', mode: 'drive' });
  await new Promise(resolve => setImmediate(resolve));
  host.close();

  await assert.rejects(pending, /地图窗口已关闭/);
  assert.equal(controller.pendingCount, 0);
});

test('map controller validates command values before opening its window', async () => {
  const host = new FakeMapWindow();
  const controller = new HoloMapController(host);
  await assert.rejects(controller.planRoute({ destination: '郑州东站', mode: 'taxi' as never }), /出行方式/);
  await assert.rejects(controller.searchNearby({ category: 'x'.repeat(201) }), /分类/);
  assert.equal(host.opened, 0);
});
