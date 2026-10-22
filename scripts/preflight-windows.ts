import { CodexRuntime, resolveCodexExecutable } from '../electron/codex-runtime.ts';
import { readFile } from 'node:fs/promises';
import { verifyHandModel } from './download-hand-landmarker.mjs';

const handModelPath = new URL('../public/models/hand_landmarker.task', import.meta.url);
try {
  if (!verifyHandModel(new Uint8Array(await readFile(handModelPath)))) throw new Error('checksum mismatch');
} catch (error) {
  throw new Error(`Missing or invalid ${handModelPath.pathname}. Run npm run windows:hand-model.`, { cause: error });
}

const runtime = new CodexRuntime({ executablePath: resolveCodexExecutable() });
runtime.onEvent(e => {
  if (e.method === 'jarvis/disconnected' && e.params) console.error(e.params.message);
  if (e.method === 'jarvis/sessionPolicy') console.log(JSON.stringify({ effectivePolicy: e.params }));
});
try {
  const session = await runtime.start({ cwd: process.cwd() });
  console.log(JSON.stringify({ connected: true, threadId: session.threadId, cwd: session.cwd }));
  if (process.argv.includes('--turn')) {
    const done = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('turn timeout')), 90000);
      runtime.onEvent(e => {
        if (e.id !== undefined && e.method) runtime.respond(e.id, false);
        if (e.method === 'item/completed' && e.params?.item?.type === 'agentMessage') console.log(e.params.item.text);
        if (e.method === 'turn/completed') { clearTimeout(timer); resolve(); }
      });
    });
    await runtime.sendText('这是连接测试。不要执行任何命令，不要读写文件。只回复“连接正常”。');
    await done;
  }
} finally { await runtime.shutdown(); }
