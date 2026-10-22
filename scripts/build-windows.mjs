import { mkdir, copyFile, cp, rm, readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { existsSync, createHash } from 'node:fs';
import { assertLocalRequiresResolvable, rewriteElectronRequires } from './electron-module-resolution.mjs';

if (!existsSync('runtime/models/jarvis-memory/onnx/model_quantized.onnx')) {
  throw new Error('缺少本地记忆嵌入模型，请先运行 npm run windows:model');
}
const czkawkaPath = 'runtime/tools/czkawka/windows_czkawka_cli.exe';
if (!existsSync(czkawkaPath)) throw new Error('缺少 Czkawka CLI，请先下载并校验 Windows 工具二进制');
const czkawkaHash = createHash('sha256').update(await readFile(czkawkaPath)).digest('hex').toUpperCase();
if (czkawkaHash !== 'EB7C2009D2DD49CF5202ACBD65370CAECE0A3F819B9515E727CEDB1EC088ED1A') throw new Error('Czkawka CLI SHA-256 校验失败');
await mkdir('dist-electron', { recursive: true });
await copyFile('electron/windows-ui-automation.ps1', 'dist-electron/windows-ui-automation.ps1');
await rm('dist-electron-build', { recursive: true, force: true });
const sources = await readdir('electron');
const electronFiles = sources.filter(name => name.endsWith('.ts')).map(name => `electron/${name}`);
const sharedFiles = [
  'src/codex-voice.ts', 'modules/holo-map/controller.ts', 'modules/holo-map/preload.ts',
  'modules/rainform/control.ts', 'modules/rainform/protocol.ts', 'modules/rainform/preload.ts',
];
const { spawnSync } = await import('node:child_process');
const compile = spawnSync(process.execPath, [
  'node_modules/typescript/bin/tsc', '--ignoreConfig', '--target', 'ES2022', '--module', 'CommonJS',
  '--moduleResolution', 'bundler', '--esModuleInterop', '--skipLibCheck', '--noEmit', 'false',
  '--outDir', 'dist-electron-build', '--rootDir', '.', '--allowImportingTsExtensions', 'false', ...electronFiles, ...sharedFiles,
], { cwd: process.cwd(), stdio: 'inherit', shell: true });
if (compile.status !== 0) throw new Error('Electron TypeScript 编译失败');

const compileOutputs = [
  ...sources.filter(name => name.endsWith('.ts')).map(name => ({
    input: `dist-electron-build/electron/${name.replace(/\.ts$/, '.js')}`,
    output: `dist-electron/${name.replace(/\.ts$/, '.cjs')}`,
  })),
  ...sharedFiles.map(name => ({
    input: `dist-electron-build/${name.replace(/\.ts$/, '.js')}`,
    output: `dist-electron/${({
      'modules/holo-map/preload.ts': 'holo-map-preload',
      'modules/holo-map/controller.ts': 'holo-map-controller',
      'modules/rainform/control.ts': 'rainform-control',
      'modules/rainform/protocol.ts': 'rainform-protocol',
      'modules/rainform/preload.ts': 'rainform-preload',
    })[name] ?? name.replace(/^src\//, '').replace(/\.ts$/, '')}.cjs`,
  })),
];
for (const { input, output } of compileOutputs) {
  const compiled = await readFile(input, 'utf8');
  const cjs = rewriteElectronRequires(compiled, {
    '../src/codex-voice': './codex-voice',
    '../modules/holo-map/controller': './holo-map-controller',
    '../modules/rainform/control': './rainform-control',
    ...(output.endsWith('rainform-control.cjs') ? { './protocol': './rainform-protocol' } : {}),
    ...(output.endsWith('holo-map-preload.cjs') || output.endsWith('rainform-preload.cjs') ? { electron: 'electron' } : {}),
  });
  await writeFile(output, cjs);
}

const mainPath = 'dist-electron/main.cjs';
assertLocalRequiresResolvable(await readFile(mainPath, 'utf8'), mainPath);
const mapPreloadPath = 'dist-electron/holo-map-preload.cjs';
assertLocalRequiresResolvable(await readFile(mapPreloadPath, 'utf8'), mapPreloadPath);
const mapControllerPath = 'dist-electron/holo-map-controller.cjs';
assertLocalRequiresResolvable(await readFile(mapControllerPath, 'utf8'), mapControllerPath);
const rainformPreloadPath = 'dist-electron/rainform-preload.cjs';
const rainformControllerPath = 'dist-electron/rainform-control.cjs';
const rainformProtocolPath = 'dist-electron/rainform-protocol.cjs';
assertLocalRequiresResolvable(await readFile(rainformPreloadPath, 'utf8'), rainformPreloadPath);
assertLocalRequiresResolvable(await readFile(rainformControllerPath, 'utf8'), rainformControllerPath);
for (const path of ['dist-windows/modules/holo-map/index.html', 'dist-electron/holo-map-preload.cjs', mapControllerPath,
  'dist-windows/modules/rainform/index.html', rainformPreloadPath, rainformControllerPath, rainformProtocolPath]) {
  if (!existsSync(path)) throw new Error(`Windows 打包缺少 Jarvis 地图模块资源：${path}`);
}

await mkdir('dist-windows/modules/rainform/audio', { recursive: true });
await copyFile('modules/rainform/public/audio/rain-loop.wav', 'dist-windows/modules/rainform/audio/rain-loop.wav');
for (const name of ['LICENSE', 'NOTICE.md', 'CITY-CATALOG-NOTICE.md', 'city-catalog.json']) {
  await copyFile(`modules/rainform/${name}`, `dist-windows/modules/rainform/${name}`);
}

// Keep the AudioWorklet as a separate local resource, rather than a renderer script.
await copyFile('public/voice-capture.js', 'dist-windows/voice-capture.js');
await mkdir('dist-windows/mediapipe/wasm', { recursive: true });
await cp('node_modules/@mediapipe/tasks-vision/wasm', 'dist-windows/mediapipe/wasm', { recursive: true });
