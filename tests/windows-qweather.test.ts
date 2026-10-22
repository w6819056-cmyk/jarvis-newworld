import assert from 'node:assert/strict';
import test from 'node:test';
import { createQWeatherClient } from '../electron/qweather.ts';

function response(value: unknown, ok = true): Response {
  return { ok, status: ok ? 200 : 503, json: async () => value } as Response;
}

test('QWeather client keeps credentials in request headers and normalizes Rainform weather data', async () => {
  const seen: Array<{ url: string; key: string | null }> = [];
  const client = createQWeatherClient({ apiHost: 'test.qweatherapi.com', apiKey: 'secret-value', fetcher: async (input, init) => {
    const url = String(input);
    seen.push({ url, key: new Headers(init?.headers).get('X-QW-Api-Key') });
    if (url.includes('/geo/')) return response({ code: '200', location: [{ id: '101180101', name: '郑州', adm1: '河南省', lat: '34.75', lon: '113.63' }] });
    if (url.includes('/weather/now')) return response({ code: '200', now: { temp: '21', feelsLike: '20', humidity: '55', windSpeed: '8', text: '小雨', icon: '305', precip: '0.8', obsTime: '2026-10-22T12:00+08:00' } });
    return response({ code: '200', hours: [{ forecastTime: '2026-10-22T13:00+08:00', precipitation: { intensity: { value: '1.2' } } }], metadata: { tag: 'forecast-tag' } });
  } });

  const cities = await client.searchCities('郑州');
  const current = await client.currentAt(34.75, 113.63);
  const forecast = await client.hourlyForecast(34.75, 113.63);
  assert.deepEqual(cities[0], { id: '101180101', name: '郑州', adm1: '河南省', latitude: 34.75, longitude: 113.63 });
  assert.equal(current.precipitationMm, 0.8);
  assert.equal(current.condition, '小雨');
  assert.equal(current.observedAt, '2026-10-22T12:00+08:00');
  assert.equal(forecast.values.length, 25);
  assert.equal(forecast.values[0], 1.2);
  assert.equal(forecast.labels[0], '13:00');
  assert.equal(forecast.updatedAt, 'forecast-tag');
  assert.equal(seen.length, 3);
  assert.ok(seen.every(item => item.key === 'secret-value'));
  assert.ok(seen.every(item => !item.url.includes('secret-value')));
});

test('QWeather client rejects unsafe hosts, malformed provider data, and failed requests', async () => {
  assert.throws(() => createQWeatherClient({ apiHost: 'https://example.com/path', apiKey: 'secret' }), /Host/);
  const malformed = createQWeatherClient({ apiHost: 'test.qweatherapi.com', apiKey: 'secret', fetcher: async () => response({ code: '200', now: { temp: 'warm', text: '晴', icon: '100' } }) });
  await assert.rejects(malformed.currentAt(34, 113), /无效|不完整/);
  const unavailable = createQWeatherClient({ apiHost: 'test.qweatherapi.com', apiKey: 'secret', fetcher: async () => response({}, false) });
  await assert.rejects(unavailable.searchCities('郑州'), /暂不可用/);
});
