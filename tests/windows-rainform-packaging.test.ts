import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const moduleRoot = resolve('modules/rainform');
const viteConfig = readFileSync(new URL('../vite.windows.config.ts', import.meta.url), 'utf8');
const buildScript = readFileSync(new URL('../scripts/build-windows.mjs', import.meta.url), 'utf8');
const builderConfig = readFileSync(new URL('../electron-builder.yml', import.meta.url), 'utf8');
const thirdPartyNotices = readFileSync(new URL('../docs/THIRD-PARTY-NOTICES.md', import.meta.url), 'utf8');
const rainformWindow = readFileSync(new URL('../electron/rainform-window.ts', import.meta.url), 'utf8');
const rainformPreload = readFileSync(new URL('../modules/rainform/preload.ts', import.meta.url), 'utf8');

test('Rainform module preserves its license and required notices', () => {
  const license = readFileSync(resolve(moduleRoot, 'LICENSE'), 'utf8');
  const notice = readFileSync(resolve(moduleRoot, 'NOTICE.md'), 'utf8');
  const catalogNotice = readFileSync(resolve(moduleRoot, 'CITY-CATALOG-NOTICE.md'), 'utf8');

  assert.match(license, /PolyForm Noncommercial License 1\.0\.0/);
  assert.match(notice, /^Required Notice: Rainform \/ 数据成雨 © 2026 afterimage/m);
  assert.match(catalogNotice, /GeoNames/);
  assert.match(catalogNotice, /Creative Commons Attribution 4\.0/);
  assert.match(catalogNotice, /PPLA2/);
});

test('Rainform catalog contains bounded China city-center records', () => {
  const catalog = JSON.parse(readFileSync(resolve(moduleRoot, 'city-catalog.json'), 'utf8')) as {
    source: string;
    cities: Array<{ id: string; name: string; latitude: number; longitude: number; countryCode: string }>;
  };

  assert.match(catalog.source, /GeoNames/);
  assert.ok(catalog.cities.length >= 250, `expected at least 250 cities, got ${catalog.cities.length}`);
  assert.ok(catalog.cities.every(city => city.id && city.name && city.countryCode === 'CN'));
  assert.ok(catalog.cities.every(city => Number.isFinite(city.latitude)
    && city.latitude >= 15 && city.latitude <= 55
    && Number.isFinite(city.longitude) && city.longitude >= 70 && city.longitude <= 140));
});

test('Rainform module excludes credentials, dependencies, and upstream build output', () => {
  for (const forbidden of ['.env', 'node_modules', 'dist']) {
    assert.equal(existsSync(resolve(moduleRoot, forbidden)), false, `${forbidden} must not be copied`);
  }
});

test('Jarvis Windows package builds Rainform as an attributed local module', () => {
  assert.match(viteConfig, /modules\/rainform\/index\.html/);
  assert.match(buildScript, /modules\/rainform\/preload\.ts/);
  assert.match(buildScript, /rainform-preload\.cjs/);
  assert.match(buildScript, /'LICENSE', 'NOTICE\.md', 'CITY-CATALOG-NOTICE\.md', 'city-catalog\.json'/);
  assert.match(buildScript, /copyFile\(`modules\/rainform\/\$\{name\}`/);
  assert.match(buildScript, /'LICENSE', 'NOTICE\.md', 'CITY-CATALOG-NOTICE\.md', 'city-catalog\.json'/);
  assert.match(builderConfig, /dist-windows\/\*\*\/*/);
  assert.match(thirdPartyNotices, /Rainform \/ 数据成雨/);
  assert.match(thirdPartyNotices, /PolyForm Noncommercial License 1\.0\.0/);
});

test('Rainform window keeps a sandboxed renderer and denies external navigation and permissions', () => {
  assert.match(rainformWindow, /contextIsolation:\s*true/);
  assert.match(rainformWindow, /sandbox:\s*true/);
  assert.match(rainformWindow, /nodeIntegration:\s*false/);
  assert.match(rainformWindow, /setWindowOpenHandler\(\(\) => \(\{ action: 'deny' \}\)\)/);
  assert.match(rainformWindow, /if \(url !== pageUrl\) event\.preventDefault\(\)/);
  assert.match(rainformWindow, /setPermissionRequestHandler\(.*callback\(false\)/s);
  assert.match(rainformPreload, /jarvis-rainform:search-cities/);
  assert.match(rainformPreload, /jarvis-rainform:current/);
  assert.match(rainformPreload, /jarvis-rainform:forecast/);
  assert.doesNotMatch(rainformPreload, /exposeInMainWorld\([^,]+,\s*ipcRenderer/);
});
