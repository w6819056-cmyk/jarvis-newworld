import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const viteConfig = readFileSync(new URL('../vite.windows.config.ts', import.meta.url), 'utf8');
const buildScript = readFileSync(new URL('../scripts/build-windows.mjs', import.meta.url), 'utf8');
const builderConfig = readFileSync(new URL('../electron-builder.yml', import.meta.url), 'utf8');
const mapHtml = readFileSync(new URL('../modules/holo-map/index.html', import.meta.url), 'utf8');
const mapWindow = readFileSync(new URL('../electron/holo-map-window.ts', import.meta.url), 'utf8');
const mapRenderer = readFileSync(new URL('../modules/holo-map/renderer/App.tsx', import.meta.url), 'utf8');
const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  version: string;
  dependencies: Record<string, string>;
  scripts: Record<string, string>;
};

test('Jarvis Windows build includes the map renderer, its isolated preload, and renderer runtime dependencies', () => {
  assert.match(viteConfig, /modules\/holo-map\/index\.html/);
  assert.match(packageJson.scripts['windows:build']!, /tsconfig\.holo-map\.json/);
  assert.match(buildScript, /modules\/holo-map\/preload\.ts/);
  assert.match(buildScript, /modules\/holo-map\/controller\.ts/);
  assert.match(buildScript, /holo-map-controller\.cjs/);
  assert.match(buildScript, /\.\.\/modules\/holo-map\/controller': '\.\/holo-map-controller/);
  assert.match(buildScript, /holo-map-preload\.cjs/);
  assert.match(builderConfig, /dist-windows\/\*\*\/*/);
  assert.ok(packageJson.dependencies.react);
  assert.ok(packageJson.dependencies['react-dom']);
  assert.ok(packageJson.dependencies['@amap/amap-jsapi-loader']);
  assert.equal(packageJson.version, '0.3.31');
  assert.match(mapWindow, /dist-windows', 'modules', 'holo-map', 'index\.html'/);
  assert.match(mapWindow, /holo-map-preload\.cjs/);
  assert.match(mapWindow, /permission === 'geolocation'/);
  assert.match(mapWindow, /permission === 'geolocation'\)/);
  assert.match(mapWindow, /!this\.isTrusted\(event\).*return/);
  assert.match(mapHtml, /https:\/\/webapi\.amap\.com/);
  assert.doesNotMatch(mapHtml, /https:\/\/\*\./);
  assert.doesNotMatch(mapRenderer, /cdn\.jsdelivr\.net\/npm\/\@mediapipe/);
  assert.doesNotMatch(mapRenderer, /securityJsCode:\s*['"][^'"]+['"]|key:\s*['"]a[0-9a-f]{31,}['"]/i);
});
