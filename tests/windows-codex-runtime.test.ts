import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";
import { CodexRuntime, resolveCodexExecutable } from "../electron/codex-runtime.ts";

class FakeChild extends EventEmitter {
  stdin = new PassThrough();
  stdout = new PassThrough();
  stderr = new PassThrough();
  killed = false;
  requests: Record<string, unknown>[] = [];

  constructor(private startResult?: any) {
    super();
    this.stdin.on("data", (chunk: Buffer) => {
      for (const line of chunk.toString().split("\n").filter(Boolean)) {
        const request = JSON.parse(line) as Record<string, unknown>;
        this.requests.push(request);
        if (request.id === undefined || !request.method) continue;
        const method = request.method;
        const result = method === "thread/start"
          ? this.startResult ?? { thread: { id: "thread-1" } }
          : method === "thread/resume"
            ? undefined
            : {};
        const response = method === "thread/resume"
          ? { id: request.id, error: { message: "thread unavailable" } }
          : { id: request.id, result };
        this.stdout.write(`${JSON.stringify(response)}\n`);
      }
    });
  }

  kill() {
    this.killed = true;
    return true;
  }
}

test("configured Codex executable takes precedence and missing overrides fail closed", () => {
  const valid = resolveCodexExecutable({
    configuredPath: "C:/tools/codex.exe",
    candidates: ["C:/fallback/codex.exe"],
    exists: (path) => path === "C:/tools/codex.exe",
  });
  assert.equal(valid, "C:/tools/codex.exe");
  assert.throws(
    () => resolveCodexExecutable({
      configuredPath: "C:/missing/codex.exe",
      candidates: ["C:/fallback/codex.exe"],
      exists: (path) => path === "C:/fallback/codex.exe",
    }),
    /JARVIS_CODEX_BIN/,
  );
});

test('startup refuses an effective policy that differs from the requested access', async () => {
  const child = new FakeChild({ thread: { id: 'thread-1' }, approvalPolicy: 'never', sandbox: { type: 'dangerFullAccess' } });
  const runtime = new CodexRuntime({ executablePath: 'codex.exe', spawnProcess: () => child as never });
  await assert.rejects(runtime.start({ cwd: 'C:/test' }), /权限配置/);
  assert.equal(child.killed, true);
});

test('duplicate approval notifications are delivered once', async () => {
  const child = new FakeChild();
  const runtime = new CodexRuntime({ executablePath: 'codex.exe', spawnProcess: () => child as never });
  await runtime.start({ cwd: 'C:/test' });
  const events: any[] = []; runtime.onEvent(e => events.push(e));
  const message = JSON.stringify({ id: 'same', method: 'item/fileChange/requestApproval', params: {} }) + '\n';
  child.stdout.write(message); child.stdout.write(message);
  assert.equal(events.length, 1);
  await runtime.shutdown();
});

test('non-object JSON lines cannot crash the protocol reader', async () => {
  const child = new FakeChild();
  const runtime = new CodexRuntime({ executablePath: 'codex.exe', spawnProcess: () => child as never });
  await runtime.start({ cwd: 'C:/test' });
  assert.doesNotThrow(() => child.stdout.write('null\n42\n[]\n'));
  await runtime.shutdown();
});

test('a completed turn arriving before its start response cannot block the next turn', async () => {
  const child = new FakeChild();
  const runtime = new CodexRuntime({ executablePath: 'codex.exe', spawnProcess: () => child as never });
  await runtime.start({ cwd: 'C:/test' });
  child.stdin.removeAllListeners('data');
  child.stdin.on('data', chunk => {
    const request = JSON.parse(chunk.toString());
    if (request.method === 'turn/start') {
      child.stdout.write(JSON.stringify({ method: 'turn/completed', params: { turn: { id: 'quick', status: 'completed' } } }) + '\n');
      child.stdout.write(JSON.stringify({ id: request.id, result: { turn: { id: 'quick' } } }) + '\n');
    }
  });
  await runtime.sendText('第一条');
  await assert.doesNotReject(runtime.sendText('第二条'));
  await runtime.shutdown();
});

test('approval replies are one-shot and use method-specific decisions', async () => {
  const child = new FakeChild();
  const runtime = new CodexRuntime({ executablePath: 'codex.exe', spawnProcess: () => child as never });
  await runtime.start({ cwd: 'C:/test' });
  child.stdout.write(JSON.stringify({ id: 'a', method: 'item/fileChange/requestApproval', params: {} }) + '\n');
  runtime.respond('a', false);
  assert.deepEqual(child.requests.at(-1), { id: 'a', result: { decision: 'decline' } });
  assert.throws(() => runtime.respond('a', true), /失效/);
  await runtime.shutdown();
});
test('legacy rejection uses the installed protocol structured denial', async () => {
  const child = new FakeChild();
  const runtime = new CodexRuntime({ executablePath: 'codex.exe', spawnProcess: () => child as never });
  await runtime.start({ cwd: 'C:/test' });
  child.stdout.write(JSON.stringify({ id: 'legacy', method: 'execCommandApproval', params: {} }) + '\n');
  runtime.respond('legacy', false);
  assert.deepEqual(child.requests.at(-1), { id: 'legacy', result: { decision: { denied: { rejection: '用户拒绝此操作' } } } });
  await runtime.shutdown();
});

test('fragmented UTF8 messages survive invalid lines and resume falls back', async () => {
  const child = new FakeChild();
  const runtime = new CodexRuntime({ executablePath: 'codex.exe', spawnProcess: () => child as never });
  await runtime.start({ cwd: 'C:/test', threadId: 'deleted' });
  const events: any[] = []; runtime.onEvent(e => events.push(e));
  const bytes = Buffer.from(JSON.stringify({ method: 'example', params: { text: '你好' } }) + '\n');
  child.stdout.write('invalid\n');
  for (const byte of bytes) child.stdout.write(Buffer.from([byte]));
  assert.equal(events.at(-1).params.text, '你好');
  assert.equal(child.requests.filter(r => r.method === 'thread/start').length, 1);
  await runtime.shutdown();
});

test('startup timeout kills the owned process', async () => {
  const child = new FakeChild(); child.stdin.removeAllListeners('data');
  const runtime = new CodexRuntime({ executablePath: 'codex.exe', spawnProcess: () => child as never, requestTimeoutMs: 20 });
  await assert.rejects(runtime.start({ cwd: 'C:/test' }), /超时/);
  assert.equal(child.killed, true);
});

test("thread startup uses full filesystem access while retaining Codex approval prompts", async () => {
  const child = new FakeChild();
  const runtime = new CodexRuntime({
    executablePath: "C:/tools/codex.exe",
    spawnProcess: () => child as never,
    requestTimeoutMs: 500,
  });

  const session = await runtime.start({ cwd: "C:/Users/test/Projects" });

  assert.deepEqual(session, { threadId: "thread-1", cwd: "C:/Users/test/Projects" });
  const start = child.requests.find((request) => request.method === "thread/start");
  assert.equal(start?.params && (start.params as Record<string, unknown>).sandbox, "danger-full-access");
  assert.equal(start?.params && (start.params as Record<string, unknown>).approvalPolicy, "on-request");
  await runtime.shutdown();
  assert.equal(child.killed, true);
});

test("final text is sent once as a Codex turn in the active thread", async () => {
  const child = new FakeChild();
  const runtime = new CodexRuntime({
    executablePath: "C:/tools/codex.exe",
    spawnProcess: () => child as never,
    requestTimeoutMs: 500,
  });
  await runtime.start({ cwd: "C:/Users/test/Projects" });

  await runtime.sendText("打开浏览器搜索天气");

  const turn = child.requests.find((request) => request.method === "turn/start");
  assert.equal((turn?.params as Record<string, unknown>).threadId, "thread-1");
  assert.deepEqual((turn?.params as Record<string, unknown>).input, [
    { type: "text", text: "打开浏览器搜索天气", text_elements: [] },
  ]);
  await runtime.shutdown();
});

test("Codex approval requests are surfaced without auto-approval", async () => {
  const child = new FakeChild();
  const runtime = new CodexRuntime({
    executablePath: "C:/tools/codex.exe",
    spawnProcess: () => child as never,
    requestTimeoutMs: 500,
  });
  await runtime.start({ cwd: "C:/Users/test/Projects" });
  const received = new Promise<Record<string, unknown>>((resolve) => runtime.onEvent(resolve));
  child.stdout.write(`${JSON.stringify({ id: "approval-1", method: "item/commandExecution/requestApproval", params: { command: ["powershell", "-Command", "Get-Date"] } })}\n`);

  assert.deepEqual(await received, {
    id: "approval-1",
    method: "item/commandExecution/requestApproval",
    params: { command: ["powershell", "-Command", "Get-Date"] },
  });
  assert.equal(child.requests.some((request) => request.id === "approval-1"), false);
  await runtime.shutdown();
});

test('Codex Voice starts with the realtime protocol and exposes SDP events', async () => {
  const child = new FakeChild();
  const runtime = new CodexRuntime({ executablePath: 'C:/tools/codex.exe', spawnProcess: () => child as never, requestTimeoutMs: 500 });
  await runtime.start({ cwd: 'C:/Users/test/Projects' });
  const events: any[] = [];
  runtime.onEvent(event => events.push(event));
  await runtime.startRealtime({ sdp: 'v=0\r\n', voice: 'cove' });
  const start = child.requests.find(request => request.method === 'thread/realtime/start');
  assert.equal((start?.params as any).threadId, 'thread-1');
  assert.equal((start?.params as any).transport.type, 'webrtc');
  assert.equal((start?.params as any).transport.sdp, 'v=0\r\n');
  child.stdout.write(JSON.stringify({ method: 'thread/realtime/sdp', params: { sdp: 'v=0-answer\r\n' } }) + '\n');
  assert.equal(events.at(-1).method, 'thread/realtime/sdp');
  await runtime.stopRealtime();
  assert.equal(child.requests.at(-1)?.method, 'thread/realtime/stop');
  await runtime.shutdown();
});
