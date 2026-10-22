import assert from 'node:assert/strict';
import test from 'node:test';
import { LocalTools, localToolSpecs } from '../electron/local-tools.js';

test('Rainform tools use strict city and nearest-search schemas', () => {
  const nearest = localToolSpecs.find(tool => tool.name === 'jarvis_find_nearest_rainy_city');
  const named = localToolSpecs.find(tool => tool.name === 'jarvis_show_city_rain');
  assert.ok(nearest);
  assert.deepEqual(nearest.inputSchema.required, []);
  assert.equal(nearest.inputSchema.additionalProperties, false);
  assert.ok(named);
  assert.deepEqual(named.inputSchema.required, ['city']);
  assert.equal(named.inputSchema.additionalProperties, false);
});

test('Rainform tools delegate locally without opening a browser or another app', async () => {
  const calls: string[] = [];
  const tools = new LocalTools({
    openUrl: async () => { calls.push('url'); },
    openApp: async () => { calls.push('app'); },
    rainform: {
      findNearestRainyCity: async () => { calls.push('nearest'); return '最近已验证城市是郑州。'; },
      showCityRain: async city => { calls.push(city); return '郑州当前小雨。'; },
    },
  });
  const nearest = await tools.call('jarvis_find_nearest_rainy_city', {});
  const named = await tools.call('jarvis_show_city_rain', { city: '郑州' });
  assert.match(nearest.contentItems[0]!.text, /郑州/);
  assert.match(named.contentItems[0]!.text, /小雨/);
  assert.deepEqual(calls, ['nearest', '郑州']);
  assert.equal((await tools.call('jarvis_show_city_rain', {})).success, false);
});
