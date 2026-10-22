import { validateRainformUpdate, type RainformCommandEnvelope, type RainformResponseEnvelope, type RainformWeatherUpdate } from './protocol';

export interface RainformWindowHost {
  open(): Promise<void>;
  focus(): void;
  send(command: RainformCommandEnvelope): void;
  onResult(handler: (trusted: boolean, response: RainformResponseEnvelope) => void): () => void;
  onClosed(handler: () => void): () => void;
}

type Pending = { resolve(): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> };

export class RainformController {
  private nextId = 1;
  private opening?: Promise<void>;
  private readonly pending = new Map<number, Pending>();
  private readonly unsubscribeResult: () => void;
  private readonly unsubscribeClosed: () => void;

  constructor(private readonly host: RainformWindowHost, private readonly options: { timeoutMs?: number } = {}) {
    this.unsubscribeResult = host.onResult((trusted, response) => this.receive(trusted, response));
    this.unsubscribeClosed = host.onClosed(() => this.rejectAll('Rainform 窗口已关闭'));
  }

  get pendingCount(): number { return this.pending.size; }

  async setCity(input: RainformWeatherUpdate): Promise<void> {
    const payload = validateRainformUpdate(input);
    if (!this.opening) this.opening = this.host.open().finally(() => { this.opening = undefined; });
    await this.opening;
    this.host.focus();
    const id = this.nextId++;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => this.reject(id, new Error('Rainform 更新超时')), this.options.timeoutMs ?? 20_000);
      this.pending.set(id, { resolve, reject, timer });
      try { this.host.send({ id, type: 'setCity', payload }); }
      catch (error) { this.reject(id, error instanceof Error ? error : new Error(String(error))); }
    });
  }

  dispose(): void {
    this.unsubscribeResult();
    this.unsubscribeClosed();
    this.rejectAll('Rainform 模块已关闭');
  }

  private receive(trusted: boolean, response: RainformResponseEnvelope): void {
    if (!response || !Number.isSafeInteger(response.id)) return;
    const pending = this.pending.get(response.id);
    if (!pending) return;
    if (!trusted || typeof response.success !== 'boolean') return this.reject(response.id, new Error('Rainform 窗口返回了无效响应'));
    if (!response.success) return this.reject(response.id, new Error(typeof response.error === 'string' ? response.error.slice(0, 300) : 'Rainform 更新失败'));
    clearTimeout(pending.timer);
    this.pending.delete(response.id);
    pending.resolve();
  }

  private reject(id: number, error: Error): void {
    const pending = this.pending.get(id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(id);
    pending.reject(error);
  }

  private rejectAll(message: string): void {
    for (const id of this.pending.keys()) this.reject(id, new Error(message));
  }
}
