import { existsSync } from 'node:fs';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { MineradioBridge } from '../electron/mineradio-bridge.ts';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const mineradioDir = process.argv[2] && path.resolve(process.argv[2]);
if (!mineradioDir) throw new Error('Usage: node --import tsx scripts/check-mineradio-dev-bridge.mjs <Mineradio-project-directory>');
const electronExe = path.join(mineradioDir, 'node_modules', 'electron', 'dist', 'electron.exe');
if (!existsSync(electronExe)) throw new Error(`Electron executable not found: ${electronExe}`);

const bridge = new MineradioBridge();
let child;
try {
  await bridge.start();
  child = spawn(electronExe, [mineradioDir, ...bridge.launchArgs], { cwd: mineradioDir, windowsHide: false, stdio: 'ignore' });
  const deadline = Date.now() + 40_000;
  while (!bridge.connected && Date.now() < deadline && child.exitCode === null) {
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (!bridge.connected) throw new Error(`Mineradio bridge handshake failed (exitCode=${child.exitCode ?? 'running'})`);
  const response = await bridge.request('player.get_state');
  if (!response.success || !response.result?.state || typeof response.result.state.playing !== 'boolean') {
    throw new Error(`Mineradio returned an invalid playback state: ${JSON.stringify(response)}`);
  }
  console.log(JSON.stringify({ connected: true, action: 'player.get_state', state: response.result.state }, null, 2));
} finally {
  await bridge.close();
  if (child && child.exitCode === null) {
    await new Promise(resolve => execFile('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => resolve()));
  }
}
