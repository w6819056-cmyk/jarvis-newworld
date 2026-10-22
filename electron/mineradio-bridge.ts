import { createServer, type Server, type Socket } from 'node:net';
import { randomBytes } from 'node:crypto';
import { MINERADIO_ACTIONS, MINERADIO_MAX_FRAME_BYTES, MINERADIO_PROTOCOL_VERSION, MINERADIO_REQUEST_TIMEOUT_MS, encodeFrame, validateRequest, type MineradioAction, type MineradioRequest } from './mineradio-protocol';

type Result = { success: boolean; result?: Record<string, unknown>; error?: { code: string; message: string } };
type Pending = { resolve(value: Result): void; timer: ReturnType<typeof setTimeout> };

export class MineradioBridge {
  readonly endpoint = `\\\\.\\pipe\\${'mineradio-jarvis'}-${randomBytes(16).toString('hex')}`;
  readonly token = randomBytes(32).toString('hex');
  private server?: Server;
  private socket?: Socket;
  private authenticated = false;
  private buffer = '';
  private nextId = 0;
  private revision = 0;
  private pending = new Map<string, Pending>();
  private listeners = new Set<(event: string, payload: Record<string, unknown>) => void>();
  constructor(private readonly timeoutMs = MINERADIO_REQUEST_TIMEOUT_MS) {}

  start() {
    if (this.server) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const server = createServer(socket => this.accept(socket));
      this.server = server;
      server.once('error', reject);
      server.listen(this.endpoint, () => { server.removeListener('error', reject); resolve(); });
    });
  }

  onEvent(listener: (event: string, payload: Record<string, unknown>) => void) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  get connected() { return this.authenticated && !!this.socket && !this.socket.destroyed; }

  private accept(socket: Socket) {
    if (this.socket && !this.socket.destroyed) { socket.destroy(); return; }
    this.socket = socket; this.authenticated = false; this.buffer = '';
    socket.setEncoding('utf8');
    socket.on('data', chunk => this.receive(String(chunk)));
    socket.on('error', () => this.disconnected(socket));
    socket.on('close', () => this.disconnected(socket));
  }

  private disconnected(socket: Socket) {
    if (this.socket !== socket) return;
    this.socket = undefined; this.authenticated = false; this.buffer = '';
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.resolve({ success: false, error: { code: 'DISCONNECTED', message: 'Mineradio 连接已断开' } }); }
    this.pending.clear();
    for (const listener of this.listeners) listener('connection', { connected: false });
  }

  private receive(chunk: string) {
    this.buffer += chunk;
    if (Buffer.byteLength(this.buffer, 'utf8') > MINERADIO_MAX_FRAME_BYTES) { this.socket?.destroy(); return; }
    let boundary: number;
    while ((boundary = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, boundary); this.buffer = this.buffer.slice(boundary + 1);
      if (!line) continue;
      let message: any;
      try { message = JSON.parse(line); } catch { this.socket?.destroy(); return; }
      if (!this.authenticated) {
        if (message?.version !== MINERADIO_PROTOCOL_VERSION || message?.type !== 'hello' || message?.token !== this.token) { this.socket?.destroy(); return; }
        this.authenticated = true;
        this.socket?.write(encodeFrame({ version: 1, type: 'ready' }));
        for (const listener of this.listeners) listener('connection', { connected: true });
        continue;
      }
      if (message?.version !== 1) { this.socket?.destroy(); return; }
      if (message?.type === 'response' && typeof message.id === 'string') {
        const pending = this.pending.get(message.id); if (!pending) continue;
        this.pending.delete(message.id); clearTimeout(pending.timer);
        pending.resolve(message.ok === true ? { success: true, result: message.result ?? {} } : { success: false, error: message.error ?? { code: 'REMOTE_ERROR', message: 'Mineradio 执行失败' } });
      } else if (message?.type === 'event' && typeof message.event === 'string' && Number.isInteger(message.revision) && message.revision > this.revision) {
        this.revision = message.revision;
        for (const listener of this.listeners) listener(message.event, message.payload && typeof message.payload === 'object' ? message.payload : {});
      } else { this.socket?.destroy(); return; }
    }
  }

  request(action: MineradioAction, payload: Record<string, unknown> = {}) {
    if (!this.authenticated || !this.socket || this.socket.destroyed) return Promise.resolve({ success: false, error: { code: 'NOT_CONNECTED', message: 'Mineradio 尚未连接；请先打开音乐播放器' } } satisfies Result);
    const id = String(++this.nextId);
    const request: MineradioRequest = validateRequest({ version: 1, type: 'request', id, action, payload });
    return new Promise<Result>(resolve => {
      const timer = setTimeout(() => { this.pending.delete(id); resolve({ success: false, error: { code: 'TIMEOUT', message: 'Mineradio 响应超时' } }); }, action === 'search.play' ? 35_000 : action === 'player.next' || action === 'player.previous' ? 22_000 : this.timeoutMs);
      this.pending.set(id, { resolve, timer });
      try { this.socket!.write(encodeFrame(request)); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); resolve({ success: false, error: { code: 'WRITE_FAILED', message: String(error) } }); }
    });
  }

  get launchArgs() { return ['--jarvis-pipe', this.endpoint, '--jarvis-token', this.token]; }

  async close() {
    for (const [id, pending] of this.pending) { clearTimeout(pending.timer); pending.resolve({ success: false, error: { code: 'CLOSED', message: 'Jarvis 音乐控制已关闭' } }); this.pending.delete(id); }
    this.socket?.destroy(); this.socket = undefined; this.authenticated = false;
    const server = this.server; this.server = undefined;
    if (server) await new Promise<void>(resolve => server.close(() => resolve()));
  }
}

export const mineradioToolSpecs = MINERADIO_ACTIONS.map(action => ({
  type: 'function', name: `jarvis_mineradio_${action.replaceAll('.', '_')}`,
  description: action === 'visual.set_preset'
    ? '切换 Mineradio 当前音乐视觉预设。presetId 使用 Mineradio 内置视觉预设编号；random=true 时随机切换到当前以外的预设。'
    : `调用 Mineradio 执行 ${action}。仅按用户明确表达的音乐播放器需求调用；必须依据工具返回结果回复，不得假称已执行。`,
  inputSchema: action === 'visual.set_preset'
    ? { type: 'object', properties: { presetId: { type: 'integer', minimum: 0, maximum: 12 }, random: { type: 'boolean', enum: [true] } }, oneOf: [{ required: ['presetId'] }, { required: ['random'] }], additionalProperties: false }
    : { type: 'object', properties: action === 'search.play' ? { query: { type: 'string' }, provider: { type: 'string', enum: ['netease', 'qq', 'kugou', 'qishui'] } } : action === 'player.set_volume' ? { volume: { type: 'integer', minimum: 0, maximum: 100 } } : {}, required: action === 'search.play' ? ['query'] : action === 'player.set_volume' ? ['volume'] : [], additionalProperties: false },
}));
mineradioToolSpecs.unshift({
  type: 'function', name: 'jarvis_mineradio_open',
  description: '打开或唤起本机 Mineradio 音乐播放器。用户说打开音乐播放器、打开 Mineradio 或启动音乐软件时调用。',
  inputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false },
} as any);

export function mineradioActionForTool(name: string): MineradioAction | undefined {
  if (name === 'jarvis_mineradio_open') return 'app.focus';
  return MINERADIO_ACTIONS.find(action => name === `jarvis_mineradio_${action.replaceAll('.', '_')}`);
}
