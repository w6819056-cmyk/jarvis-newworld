import assert from 'node:assert/strict';
import test from 'node:test';
import { lookupWeather } from '../electron/weather.ts';

function response(value: unknown, ok = true): Response {
  return { ok, status: ok ? 200 : 503, json: async () => value } as Response;
}

const location = { results: [{ name: '上海', latitude: 31.23, longitude: 121.47, country: '中国' }] };
const forecast = { current: { temperature_2m: 21, apparent_temperature: 20, relative_humidity_2m: 58, weather_code: 1, wind_speed_10m: 9 } };

test('uses an explicitly requested city without IP geolocation', async () => {
  const urls: string[] = [];
  const fetcher: typeof fetch = async input => {
    const url = String(input); urls.push(url);
    return response(url.includes('geocoding') ? location : forecast);
  };
  const result = await lookupWeather({ city: '上海', fetcher });
  assert.equal(result.city, '上海');
  assert.equal(result.latitude, 31.23);
  assert.equal(result.longitude, 121.47);
  assert.equal(result.temperature, 21);
  assert.equal(result.weatherCode, 1);
  assert.equal(result.locationMode, 'named');
  assert.equal(urls.length, 2);
  assert.ok(urls[0]!.includes('name=%E4%B8%8A%E6%B5%B7'));
  assert.ok(urls.every(url => !url.includes('ipapi')));
});

test('resolves the current city from IP when no city is specified', async () => {
  const urls: string[] = [];
  const fetcher: typeof fetch = async input => {
    const url = String(input); urls.push(url);
    if (url.includes('ipwho.is')) return response({ city: '上海', success: true });
    return response(url.includes('geocoding') ? location : forecast);
  };
  const result = await lookupWeather({ fetcher });
  assert.equal(result.city, '上海');
  assert.equal(result.locationMode, 'current');
  assert.equal(result.latitude, 31.23);
  assert.equal(urls.length, 3);
  assert.ok(urls[0]!.includes('ipwho.is'));
});

test('reports unknown cities and weather-service failures clearly', async () => {
  const noCity: typeof fetch = async () => response({ results: [] });
  await assert.rejects(lookupWeather({ city: '不存在城市', fetcher: noCity }), /找不到城市/);
  let requestCount = 0;
  const unavailable: typeof fetch = async () => ++requestCount === 1 ? response(location) : response({}, false);
  await assert.rejects(lookupWeather({ city: '上海', fetcher: unavailable }), /天气服务/);
});

test('rejects blank and overlong city names before making a request', async () => {
  let calls = 0;
  const fetcher: typeof fetch = async () => { calls++; return response(location); };
  await assert.rejects(lookupWeather({ city: '   ', fetcher }), /城市名称/);
  await assert.rejects(lookupWeather({ city: '城'.repeat(81), fetcher }), /城市名称/);
  assert.equal(calls, 0);
});
