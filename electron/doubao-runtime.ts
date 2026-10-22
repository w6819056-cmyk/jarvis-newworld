import WebSocket from 'ws';
import { randomUUID } from 'node:crypto';
import { decodeDoubaoFrame, decodeDoubaoTtsFrame, encodeDoubaoAudio, encodeDoubaoJson, encodeDoubaoTtsRequest } from './doubao-protocol';

export type DoubaoTranscript = { text: string; final: boolean };

export function doubaoPlaybackDurationMs(chunks: Buffer[]): number {
  const samples = chunks.reduce((total, chunk) => total + Math.floor(chunk.byteLength / 2), 0);
  return Math.ceil(samples * 1000 / 24000);
}

export function float32ToPcm16(samples: Float32Array): Buffer {
  const output = Buffer.allocUnsafe(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    const value = Math.max(-1, Math.min(1, samples[i]));
    output.writeInt16LE(value < 0 ? Math.round(value * 32768) : Math.round(value * 32767), i * 2);
  }
  return output;
}

function parseJsonObject(value: unknown): any {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return value; }
}

function isTruthyFinalMarker(value: unknown) {
  return value === true || value === 1 || value === '1' || value === 'true';
}

export function extractDoubaoTranscript(value: any): DoubaoTranscript | undefined {
  const root = parseJsonObject(value) ?? {};
  const payload = parseJsonObject(root.payload_msg) ?? {};
  const rawResult = parseJsonObject(payload.result ?? root.result ?? payload.additions ?? root.additions);
  const result = Array.isArray(rawResult) ? rawResult[0] : rawResult;
  const text = [result?.text, payload.text, root.text, result?.additions?.text, payload.additions?.text]
    .find(candidate => typeof candidate === 'string' && candidate.trim())?.trim() ?? '';
  if (!text) return undefined;
  // Depending on the ASR response variant, the endpoint marker may be on
  // the result, payload_msg, or the outer frame. Treat all of them equally;
  // otherwise a wake phrase can remain a partial forever and never reach the
  // command/acknowledgement path.
  const final = [result, payload, root, value].some(candidate => candidate && (
    isTruthyFinalMarker(candidate.definite)
    || isTruthyFinalMarker(candidate.is_last_package)
    || isTruthyFinalMarker(candidate.is_final)
  ));
  return { text, final };
}

export function isDoubaoAudioFrame(header: Buffer): boolean {
  return header.length >= 2 && (header[1] >> 4) === 0x0b;
}

export function isDoubaoTtsFinished(value: any): boolean {
  return value?.event === 'TTSSentenceEnd' || value?.event === 'SessionFinished' || value === 351 || value === 152;
}

export function extractDoubaoError(value: any): string | undefined {
  const code = value?.code ?? value?.payload_msg?.code;
  if (code === undefined || code === 0 || code === '0') return undefined;
  const message = value?.message ?? value?.payload_msg?.message ?? value?.error ?? value?.payload_msg?.error;
  return `豆包返回错误 ${String(code)}${message ? `：${String(message)}` : ''}`;
}

export class DoubaoRuntime {
  private socket?: WebSocket;
  private ready = false;
  private listeners = new Set<(transcript: DoubaoTranscript) => void>();
  constructor(private readonly options: { apiKey: string; resourceId: string; websocket?: typeof WebSocket; onError?: (error: Error) => void }) {}
  onTranscript(listener: (transcript: DoubaoTranscript) => void) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  private emit(transcript: DoubaoTranscript) { for (const listener of this.listeners) listener(transcript); }
  async start() {
    if (this.ready) return;
    if (!this.options.apiKey.trim() || !this.options.resourceId.trim()) throw new Error('请填写豆包 API Key 和 ASR 资源标识');
    const Socket = this.options.websocket ?? WebSocket;
    // `bigmodel_async` waits for an utterance to finish. The bidirectional
    // endpoint returns partial transcripts while the user is speaking.
    const socket = new Socket('wss://openspeech.bytedance.com/api/v3/sauc/bigmodel', {
      headers: { 'X-Api-Key': this.options.apiKey, 'X-Api-Resource-Id': this.options.resourceId, 'X-Api-Request-Id': randomUUID() },
    });
    this.socket = socket;
    await new Promise<void>((resolve, reject) => {
      const onOpen = () => { cleanup(); resolve(); };
      const onError = (error: Error) => { cleanup(); reject(new Error(`豆包 ASR 连接失败：${error.message}`)); };
      const cleanup = () => { socket.off('open', onOpen); socket.off('error', onError); };
      socket.once('open', onOpen); socket.once('error', onError);
    });
    socket.on('message', (data: WebSocket.RawData) => {
      void decodeDoubaoFrame(Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer)).then(decoded => {
        const error = extractDoubaoError(decoded.json);
        if (error) {
          this.ready = false;
          this.options.onError?.(new Error(error));
          return;
        }
        const transcript = extractDoubaoTranscript(decoded.json);
        if (transcript) this.emit(transcript);
      }).catch(error => {
        this.options.onError?.(error instanceof Error ? new Error(`豆包 ASR 响应解析失败：${error.message}`) : new Error(`豆包 ASR 响应解析失败：${String(error)}`));
      });
    });
    socket.on('error', error => { this.ready = false; this.options.onError?.(new Error(`豆包 ASR 连接失败：${error.message}`)); });
    socket.on('close', () => {
      if (this.ready) {
        this.ready = false;
        this.options.onError?.(new Error('豆包 ASR 连接已关闭'));
      }
    });
    await this.sendJson({
      audio: { format: 'pcm', codec: 'raw', rate: 16000, bits: 16, channel: 1 },
      request: {
        model_name: 'bigmodel', enable_nonstream: false, enable_itn: true, enable_punc: true,
        result_type: 'single', show_utterances: false, end_window_size: 800,
        corpus: { context: JSON.stringify({ hotwords: [{ word: '贾维斯' }, { word: 'Jarvis' }, { word: '检查战甲' }] }) },
      },
    });
    this.ready = true;
  }
  private async sendJson(value: unknown) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) throw new Error('豆包 ASR 尚未连接');
    this.socket.send(await encodeDoubaoJson(value));
  }
  sendAudio(samples: Float32Array) {
    if (!this.ready || !this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    void encodeDoubaoAudio(float32ToPcm16(samples)).then(frame => this.socket?.send(frame));
  }
  async stop() {
    const socket = this.socket;
    this.socket = undefined; this.ready = false;
    if (socket) await new Promise<void>(resolve => { socket.once('close', () => resolve()); socket.close(); setTimeout(resolve, 500).unref(); });
  }
}

export class DoubaoTtsRuntime {
  constructor(private readonly options: { apiKey: string; resourceId: string; voiceType: string; websocket?: typeof WebSocket }) {}
  async speak(text: string): Promise<Buffer[]> {
    if (!this.options.apiKey.trim() || !this.options.resourceId.trim()) throw new Error('请填写豆包 API Key 和 TTS 资源标识');
    const Socket = this.options.websocket ?? WebSocket;
    const socket = new Socket('wss://openspeech.bytedance.com/api/v3/tts/bidirection', {
      headers: { 'X-Api-Key': this.options.apiKey, 'X-Api-Resource-Id': this.options.resourceId, 'X-Api-Connect-Id': randomUUID() },
    });
    const chunks: Buffer[] = [];
    const sessionId = randomUUID();
    const waiters: Array<{ event: number; resolve: (frame: Awaited<ReturnType<typeof decodeDoubaoTtsFrame>>) => void; reject: (error: Error) => void }> = [];
    const waitFor = (event: number) => new Promise<Awaited<ReturnType<typeof decodeDoubaoTtsFrame>>>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`豆包 TTS 等待事件 ${event} 超时`)), 10000);
      waiters.push({ event, resolve: frame => { clearTimeout(timer); resolve(frame); }, reject });
    });
    const finished = new Promise<void>((resolve, reject) => {
      socket.once('open', resolve);
      socket.once('error', error => reject(new Error(`豆包 TTS 连接失败：${error.message}`)));
      socket.on('message', data => {
        void decodeDoubaoTtsFrame(Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer)).then(frame => {
          if (isDoubaoAudioFrame(frame.header)) chunks.push(frame.payload);
          const waiter = frame.event === undefined ? undefined : waiters.find(item => item.event === frame.event);
          if (waiter) { waiters.splice(waiters.indexOf(waiter), 1); waiter.resolve(frame); }
        }).catch(error => { for (const waiter of waiters.splice(0)) waiter.reject(error instanceof Error ? error : new Error(String(error))); });
      });
    });
    try {
      await finished;
      socket.send(await encodeDoubaoTtsRequest(1, undefined, {}));
      await waitFor(50);
      socket.send(await encodeDoubaoTtsRequest(100, sessionId, { user: { uid: 'jarvis' }, req_params: { text: '', speaker: this.options.voiceType, audio_params: { format: 'pcm', sample_rate: 24000 } } }));
      await waitFor(150);
      socket.send(await encodeDoubaoTtsRequest(200, sessionId, { user: { uid: 'jarvis' }, req_params: { text: text.slice(0, 1600) } }));
      socket.send(await encodeDoubaoTtsRequest(102, sessionId, {}));
      await waitFor(152);
      return chunks;
    } finally {
      socket.close();
    }
  }
}
