import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const weather = readFileSync(new URL('../modules/rainform/src/weather.js', import.meta.url), 'utf8');
const main = readFileSync(new URL('../modules/rainform/src/main.js', import.meta.url), 'utf8');

test('packaged Rainform weather access goes through the restricted Jarvis bridge', () => {
  assert.match(weather, /rainformBridge\.searchCities/);
  assert.match(weather, /rainformBridge\.currentAt/);
  assert.match(weather, /rainformBridge\.hourlyForecast/);
  assert.doesNotMatch(weather, /fetch\(['"]\/qweather\//);
});

test('Rainform applies Jarvis city updates and acknowledges only after its scene update', () => {
  assert.match(main, /rainformBridge\??\.onCommand/);
  assert.match(main, /const \{ city, current, forecast \} = command\.payload/);
  assert.match(main, /setCurrentCity\(\{ name: city\.name/);
  assert.match(main, /applyRainfallData\(forecast\.values\)/);
  assert.match(main, /rainformBridge\.completeCommand/);
  assert.match(main, /precipitationMm/);
});
