import type { MapController, MapCommand, MapCommandEnvelope, MapResponseEnvelope, NearbySearchResult, RoutePlanResult, TravelMode } from './protocol';

export interface MapWindowHost {
  open(): Promise<void>;
  focus(): void;
  send(command: MapCommandEnvelope): void;
  onResult(handler: (trusted: boolean, response: MapResponseEnvelope) => void): () => void;
  onClosed(handler: () => void): () => void;
}

type PendingRequest = {
  type: MapCommand['type'];
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export class HoloMapController implements MapController {
  private nextId = 1;
  private opening?: Promise<void>;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly unsubscribeResult: () => void;
  private readonly unsubscribeClosed: () => void;

  constructor(private readonly host: MapWindowHost, private readonly options: { timeoutMs?: number } = {}) {
    this.unsubscribeResult = host.onResult((trusted, response) => this.receive(trusted, response));
    this.unsubscribeClosed = host.onClosed(() => this.rejectPending('地图窗口已关闭'));
  }

  get pendingCount(): number {
    return this.pending.size;
  }

  async getCurrentLocation(): Promise<{ latitude: number; longitude: number; address: string }> {
    const result = await this.request({ type: 'getCurrentLocation', payload: {} });
    if (!isRecord(result) || !Number.isFinite(result.latitude) || Number(result.latitude) < -90 || Number(result.latitude) > 90 ||
        !Number.isFinite(result.longitude) || Number(result.longitude) < -180 || Number(result.longitude) > 180 ||
        typeof result.address !== 'string' || result.address.length > 300) {
      throw new Error('地图模块返回了无效的位置坐标');
    }
    return { latitude: Number(result.latitude), longitude: Number(result.longitude), address: result.address };
  }

  async searchNearby(args: { category: string }): Promise<NearbySearchResult> {
    if (typeof args?.category !== 'string' || !args.category.trim() || args.category.length > 200) throw new Error('附近地点分类需为 1 到 200 个字符');
    const result = await this.request({ type: 'searchNearby', payload: { category: args.category.trim() } });
    if (!isRecord(result) || !Array.isArray(result.places) || result.places.length > 25) throw new Error('地图模块返回了无效的附近地点结果');
    const places = result.places.map((place: unknown) => {
      if (!isRecord(place) || typeof place.name !== 'string' || typeof place.address !== 'string' || !Number.isFinite(place.distanceMeters)) throw new Error('地图模块返回了无效的地点');
      return { name: place.name.slice(0, 120), address: place.address.slice(0, 300), distanceMeters: Math.max(0, Number(place.distanceMeters)) };
    });
    return { places };
  }

  async planRoute(args: { destination: string; mode: TravelMode }): Promise<RoutePlanResult> {
    if (typeof args?.destination !== 'string' || !args.destination.trim() || args.destination.length > 200) throw new Error('目的地需为 1 到 200 个字符');
    if (args.mode !== 'drive' && args.mode !== 'ride' && args.mode !== 'walk') throw new Error('出行方式仅支持驾车、骑行或步行');
    const result = await this.request({ type: 'planRoute', payload: { destination: args.destination.trim(), mode: args.mode } });
    if (!isRecord(result)) throw new Error('地图模块返回了无效的路线结果');
    if (result.status === 'needsSelection' && typeof result.destination === 'string' && Array.isArray(result.candidates) && result.candidates.length <= 5) {
      const candidates = result.candidates.map((candidate: unknown) => {
        if (!isRecord(candidate) || typeof candidate.name !== 'string' || typeof candidate.address !== 'string') throw new Error('地图模块返回了无效的地点候选');
        return { name: candidate.name.slice(0, 120), address: candidate.address.slice(0, 300) };
      });
      return { status: 'needsSelection', destination: result.destination.slice(0, 200), candidates };
    }
    if (result.status === 'planned' && typeof result.origin === 'string' && typeof result.destination === 'string' && Number.isFinite(result.distanceMeters) && Number.isFinite(result.durationSeconds) && ['drive', 'ride', 'walk'].includes(String(result.mode))) {
      return {
        status: 'planned', origin: result.origin.slice(0, 120), destination: result.destination.slice(0, 200), mode: result.mode as TravelMode,
        distanceMeters: Math.max(0, Number(result.distanceMeters)), durationSeconds: Math.max(0, Number(result.durationSeconds)),
      };
    }
    throw new Error('地图模块返回了无效的路线结果');
  }

  dispose(): void {
    this.unsubscribeResult();
    this.unsubscribeClosed();
    this.rejectPending('地图模块已关闭');
  }

  private async request(command: MapCommand): Promise<unknown> {
    if (!this.opening) {
      this.opening = this.host.open().finally(() => { this.opening = undefined; });
    }
    await this.opening;
    this.host.focus();
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timeoutMs = this.options.timeoutMs ?? 30_000;
      const timer = setTimeout(() => this.reject(id, new Error('地图请求超时，请检查地图窗口和网络连接')), timeoutMs);
      this.pending.set(id, { type: command.type, resolve, reject, timer });
      try {
        this.host.send({ ...command, id } as MapCommandEnvelope);
      } catch (error) {
        this.reject(id, error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private receive(trusted: boolean, response: MapResponseEnvelope): void {
    if (!isRecord(response) || !Number.isSafeInteger(response.id)) return;
    if (!trusted) {
      this.reject(Number(response.id), new Error('地图窗口消息无效'));
      return;
    }
    if (typeof response.success !== 'boolean') return this.reject(Number(response.id), new Error('地图窗口返回了无效响应'));
    const pending = this.pending.get(Number(response.id));
    if (!pending) return;
    if (!response.success) {
      this.reject(Number(response.id), new Error(typeof response.error === 'string' ? response.error.slice(0, 500) : '地图操作失败'));
      return;
    }
    clearTimeout(pending.timer);
    this.pending.delete(Number(response.id));
    pending.resolve(response.result);
  }

  private reject(id: number, error: Error): void {
    const pending = this.pending.get(id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(id);
    pending.reject(error);
  }

  private rejectPending(message: string): void {
    for (const [id] of this.pending) this.reject(id, new Error(message));
  }
}
