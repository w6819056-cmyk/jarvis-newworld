import assert from 'node:assert/strict';
import test from 'node:test';
import { RainformOrchestrator } from '../electron/rainform-orchestration.js';
import type { RainCity, RainObservation, RainSearchResult } from '../electron/rain-search.js';
import type { QWeatherCity, QWeatherCurrent, QWeatherForecast } from '../electron/qweather.js';

const current: QWeatherCurrent = { temperature: 18, condition: '小雨', iconCode: 305, precipitationMm: 1.2, observedAt: '10:00' };
const forecast: QWeatherForecast = { values: Array(25).fill(0), labels: Array.from({ length: 25 }, (_, i) => `${i}:00`), updatedAt: '10:00' };
const city: RainCity = { id: 'geonames-1', name: '郑州', latitude: 34.75, longitude: 113.63, countryCode: 'CN' };
const providerCity: QWeatherCity = { id: '101180101', name: '郑州', adm1: '河南省', latitude: 34.75, longitude: 113.63 };

function setup(result: RainSearchResult, matches: QWeatherCity[] = [providerCity]) {
  const seen: { latitude?: number; longitude?: number; update?: unknown } = {};
  const service = new RainformOrchestrator({
    map: { getCurrentLocation: async () => ({ latitude: 34.7, longitude: 113.6, address: '郑州市' }) },
    rainSearch: { findNearestRainyCity: async input => { seen.latitude = input.origin.latitude; seen.longitude = input.origin.longitude; return result; } },
    getWeather: () => ({ searchCities: async () => matches, currentAt: async () => current, hourlyForecast: async () => forecast }),
    rainform: { setCity: async update => { seen.update = update; } },
    cities: [city],
  });
  return { service, seen };
}

test('nearest-rain orchestration uses device location and updates Rainform before returning', async () => {
  const { service, seen } = setup({ status: 'found', city, distanceMeters: 5_000, current: current as RainObservation, partial: false, unresolvedCloserCities: 0, unresolvedCities: 0 });
  const text = await service.findNearestRainyCity();
  assert.equal(seen.latitude, 34.7);
  assert.match(text, /郑州/);
  assert.match(text, /1\.2 mm/);
  assert.match(text, /Rainform/);
  assert.equal((seen.update as { city: { id: string } }).city.id, providerCity.id);
});

test('nearest-rain orchestration qualifies unresolved closer observations', async () => {
  const { service } = setup({ status: 'found', city, distanceMeters: 5_000, current: current as RainObservation, partial: true, unresolvedCloserCities: 1, unresolvedCities: 1 });
  assert.match(await service.findNearestRainyCity(), /最近已验证/);
});

test('named-city orchestration asks for clarification when multiple exact cities match', async () => {
  const second: QWeatherCity = { ...providerCity, id: '101180102', name: '郑州', adm1: '其他省份', latitude: 35, longitude: 114 };
  const { service, seen } = setup({ status: 'none', partial: false, unresolvedCloserCities: 0, unresolvedCities: 0 }, [providerCity, second]);
  const text = await service.showCityRain('郑州');
  assert.match(text, /请指定省份/);
  assert.equal(seen.update, undefined);
});

test('named-city orchestration switches Rainform with current and forecast data', async () => {
  const { service, seen } = setup({ status: 'none', partial: false, unresolvedCloserCities: 0, unresolvedCities: 0 });
  assert.match(await service.showCityRain('郑州'), /1\.2 mm/);
  assert.deepEqual((seen.update as { forecast: QWeatherForecast }).forecast.values, forecast.values);
});
