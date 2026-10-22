import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const renderer = await readFile(new URL('../src/windows-main.ts', import.meta.url), 'utf8');
const styles = await readFile(new URL('../src/windows.css', import.meta.url), 'utf8');
const document = await readFile(new URL('../windows.html', import.meta.url), 'utf8');

test('weather HUD renders a map, location marker, icon, temperature, and details', () => {
  assert.match(renderer, /win-weather-card/);
  assert.match(renderer, /weather-map/);
  assert.match(renderer, /weather-location/);
  assert.match(renderer, /weather-icon/);
  assert.match(renderer, /weather-temperature/);
  assert.match(renderer, /weather-details/);
  assert.match(renderer, /openstreetmap\.org/);
  assert.match(renderer, /circleMarker/);
  assert.match(renderer, /initializeWeatherMap/);
  assert.match(renderer, /weatherKey/);
  assert.match(renderer, /weatherKey\(next\.weather\) !== weatherKey\(previousWeather\)/);
  assert.match(renderer, /tileerror/);
  assert.match(renderer, /地图加载失败/);
  assert.match(document, /https:\/\/\*\.tile\.openstreetmap\.org/);
});

test('weather HUD disposes Leaflet maps when a card closes or the window unloads', () => {
  assert.match(renderer, /weatherMaps/);
  assert.match(renderer, /\.remove\(\)/);
  assert.match(renderer, /weatherMaps\.clear\(\)/);
});

test('weather card has bounded map layout and preserves text-card styling', () => {
  assert.match(styles, /\.win-weather-card/);
  assert.match(styles, /\.weather-map/);
  assert.match(styles, /\.weather-details/);
  assert.match(styles, /\.weather-map-status/);
  assert.match(styles, /container-type:inline-size/);
  assert.match(styles, /\.win-hud-card>p/);
});
