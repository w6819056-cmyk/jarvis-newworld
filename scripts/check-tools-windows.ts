// Protocol-only smoke test. Does not open apps, browse, type into windows or edit files.
import { CodexRuntime, resolveCodexExecutable } from '../electron/codex-runtime.ts';
import { LocalTools, localToolSpecs } from '../electron/local-tools.ts';
let observed = '';
const tools = new LocalTools({ openUrl: async url => { observed = url; throw new Error('仅验证路由，没有实际打开浏览器。'); }, openApp: async () => { throw new Error('此测试不启动应用。'); } });
const runtime = new CodexRuntime({ executablePath: resolveCodexExecutable(), dynamicTools: localToolSpecs });
try {
  await runtime.start({ cwd: process.cwd() });
  let finish: () => void;
  const done = new Promise<void>(resolve => { finish = resolve; });
  const timeout = setTimeout(() => { console.error('Tool routing timed out'); process.exitCode = 1; finish(); }, 90000);
  runtime.onEvent(e => {
    if (e.id !== undefined && e.method === 'item/tool/call') void tools.call(e.params.tool, e.params.arguments).then(result => runtime.respondTool(e.id!, result));
    else if (e.id !== undefined && e.method) runtime.respond(e.id, false);
    if (e.method === 'turn/completed') finish();
  });
  try {
    await runtime.sendText('协议连接测试：只调用一次 jarvis_search_web，query 为 Windows 11。此测试中的工具只检查参数路由，不会打开浏览器。不要调用其他工具，不要操作窗口或读写文件。然后如实说明没有实际打开浏览器。');
    await done;
    if (observed !== 'https://www.bing.com/search?q=Windows%2011') throw new Error('Did not receive expected tool call');
    console.log('PASS: real Codex dynamic-tool request reached the validated local browser adapter; no browser opened.');
  } finally { clearTimeout(timeout); }
} finally { await runtime.shutdown(); }
