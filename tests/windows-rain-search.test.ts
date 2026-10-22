import assert from 'node:assert/strict';
import test from 'node:test';
import { createRainSearchService, haversineMeters, type RainCity, type RainObservation } from '../electron/rain-search.js';

function city(id: string, latitude: number, longitude = 0): RainCity {
  return { id, name: id, latitude, longitude, countryCode: 'CN' };
}

function observation(overrides: Partial<RainObservation> = {}): RainObservation {
  return { condition: '晴', iconCode: 100, precipitationMm: 0, ...overrides };
}

test('distance ordering is stable and rainfall classification uses current conditions only', () => {
  assert.equal(haversineMeters({ latitude: 0, longitude: 0 }, { latitude: 1, longitude: 0 }) > 111_000, true);
  const service = createRainSearchService({ readCurrent: async () => observation() });
  assert.equal(service.isRaining(observation({ iconCode: 305 })), true);
  assert.equal(service.isRaining(observation({ precipitationMm: 0.1 })), true);
  assert.equal(service.isRaining(observation({ condition: '小雨' })), true);
  assert.equal(service.isRaining(observation({ condition: '晴', iconCode: 100, precipitationMm: 0 })), false);
  assert.equal(service.isRaining(observation({ condition: '小雪', iconCode: 400 })), false);
});

test('search evaluates nearest-first batches and picks the closest rainy city in the first rainy batch', async () => {
  const seen: string[] = [];
  const service = createRainSearchService({
    readCurrent: async (candidate) => {
      seen.push(candidate.id);
      return candidate.id === 'near' || candidate.id === 'far'
        ? observation({ condition: '小雨', iconCode: 305 })
        : observation();
    },
  });

  const result = await service.findNearestRainyCity({
    origin: { latitude: 0, longitude: 0 },
    cities: [city('far', 3), city('dry', 1), city('near', 2)],
  });

  assert.equal(result.status, 'found');
  assert.equal(result.city?.id, 'near');
  assert.deepEqual(seen, ['dry', 'near', 'far']);
  assert.equal(result.partial, false);
});

test('a failed closer city is retried once and makes a farther rainy result partial', async () => {
  const attempts = new Map<string, number>();
  const service = createRainSearchService({ readCurrent: async candidate => {
    attempts.set(candidate.id, (attempts.get(candidate.id) ?? 0) + 1);
    if (candidate.id === 'close') throw new Error('offline');
    return observation({ condition: '小雨', iconCode: 305 });
  } });

  const result = await service.findNearestRainyCity({ origin: { latitude: 0, longitude: 0 }, cities: [city('close', 1), city('rain', 2)] });
  assert.equal(attempts.get('close'), 2);
  assert.equal(result.city?.id, 'rain');
  assert.equal(result.partial, true);
  assert.equal(result.unresolvedCloserCities, 1);
});

test('search limits concurrency to eight and caches valid observations for ten minutes', async () => {
  let now = 1_000;
  let active = 0;
  let maximum = 0;
  let calls = 0;
  const service = createRainSearchService({ now: () => now, readCurrent: async () => {
    calls++;
    active++;
    maximum = Math.max(maximum, active);
    await new Promise(resolve => setTimeout(resolve, 1));
    active--;
    return observation();
  } });
  const cities = Array.from({ length: 25 }, (_, index) => city(String(index), index + 1));

  await service.findNearestRainyCity({ origin: { latitude: 0, longitude: 0 }, cities });
  assert.ok(maximum <= 8);
  assert.equal(calls, 25);
  await service.findNearestRainyCity({ origin: { latitude: 0, longitude: 0 }, cities });
  assert.equal(calls, 25);
  now += 10 * 60 * 1000 + 1;
  await service.findNearestRainyCity({ origin: { latitude: 0, longitude: 0 }, cities });
  assert.equal(calls, 50);
});

test('returns none after a successfully checked catalog and rejects invalid coordinates', async () => {
  const service = createRainSearchService({ readCurrent: async () => observation() });
  const result = await service.findNearestRainyCity({ origin: { latitude: 0, longitude: 0 }, cities: [city('dry', 1)] });
  assert.equal(result.status, 'none');
  await assert.rejects(service.findNearestRainyCity({ origin: { latitude: 91, longitude: 0 }, cities: [] }), /坐标/);
});
