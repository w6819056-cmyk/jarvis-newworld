import { app, BrowserWindow, ipcMain, session, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { QWeatherCity, QWeatherCurrent, QWeatherForecast } from './qweather';
import type { RainformCommandEnvelope, RainformResponseEnvelope } from '../modules/rainform/protocol';
import type { RainformWindowHost } from '../modules/rainform/control';

type RainformWeatherClient = {
  searchCities(query: string): Promise<QWeatherCity[]>;
  currentAt(latitude: number, longitude: number): Promise<QWeatherCurrent>;
  hourlyForecast(latitude: number, longitude: number): Promise<QWeatherForecast>;
};

const partitionName = 'persist:jarvis-rainform';

export class ElectronRainformWindow implements RainformWindowHost {
  private window?: BrowserWindow;
  private rendererReady?: { window: BrowserWindow; promise: Promise<void>; resolve(): void; reject(error: Error): void };
  private resultHandlers = new Set<(trusted: boolean, response: RainformResponseEnvelope) => void>();
  private closedHandlers = new Set<() => void>();
  private ipcReady = false;

  constructor(private readonly getClient: () => RainformWeatherClient) {}

  async open(): Promise<void> {
    this.installIpc();
    if (this.window && !this.window.isDestroyed()) {
      if (this.window.isMinimized()) this.window.restore();
      await this.waitForRenderer(this.window);
      return;
    }
    const rainformSession = session.fromPartition(partitionName);
    rainformSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    rainformSession.setPermissionCheckHandler(() => false);
    const window = new BrowserWindow({
      width: 1440, height: 920, minWidth: 960, minHeight: 640, show: false, autoHideMenuBar: true,
      title: 'Jarvis 雨幕可视化', backgroundColor: '#050b12',
      webPreferences: {
        preload: path.join(__dirname, 'rainform-preload.cjs'), session: rainformSession,
        contextIsolation: true, sandbox: true, nodeIntegration: false,
      },
    });
    this.window = window;
    let resolveReady!: () => void;
    let rejectReady!: (error: Error) => void;
    const promise = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
    this.rendererReady = { window, promise, resolve: resolveReady, reject: rejectReady };
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    const pagePath = path.join(app.getAppPath(), 'dist-windows', 'modules', 'rainform', 'index.html');
    const pageUrl = pathToFileURL(pagePath).href;
    window.webContents.on('will-navigate', (event, url) => { if (url !== pageUrl) event.preventDefault(); });
    window.on('closed', () => {
      if (this.window === window) this.window = undefined;
      if (this.rendererReady?.window === window) {
        this.rendererReady.reject(new Error('Rainform 窗口在初始化前已关闭'));
        this.rendererReady = undefined;
      }
      for (const handler of this.closedHandlers) handler();
    });
    try {
      await window.loadFile(pagePath);
      await this.waitForRenderer(window);
      if (!window.isDestroyed()) window.show();
    } catch (error) {
      if (!window.isDestroyed()) window.destroy();
      throw new Error(`Jarvis Rainform 模块加载失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  focus(): void {
    if (!this.window || this.window.isDestroyed()) return;
    if (this.window.isMinimized()) this.window.restore();
    this.window.show();
    this.window.focus();
  }

  send(command: RainformCommandEnvelope): void {
    if (!this.window || this.window.isDestroyed() || this.window.webContents.isLoading()) throw new Error('Rainform 窗口尚未就绪');
    this.window.webContents.send('jarvis-rainform:command', command);
  }

  onResult(handler: (trusted: boolean, response: RainformResponseEnvelope) => void): () => void {
    this.resultHandlers.add(handler);
    return () => this.resultHandlers.delete(handler);
  }

  onClosed(handler: () => void): () => void {
    this.closedHandlers.add(handler);
    return () => this.closedHandlers.delete(handler);
  }

  close(): void { if (this.window && !this.window.isDestroyed()) this.window.close(); }

  private installIpc(): void {
    if (this.ipcReady) return;
    this.ipcReady = true;
    ipcMain.on('jarvis-rainform:ready', event => {
      const gate = this.rendererReady;
      if (this.isTrusted(event) && gate && gate.window === this.window) gate.resolve();
    });
    ipcMain.on('jarvis-rainform:result', (event, value: unknown) => {
      if (!this.isTrusted(event) || !value || typeof value !== 'object' || Array.isArray(value)) return;
      for (const handler of this.resultHandlers) handler(true, value as RainformResponseEnvelope);
    });
    ipcMain.handle('jarvis-rainform:search-cities', async (event, query: unknown) => {
      if (!this.isTrusted(event) || typeof query !== 'string' || query.length > 80) throw new Error('无效 Rainform 城市搜索请求');
      return this.getClient().searchCities(query);
    });
    for (const [channel, method] of [
      ['jarvis-rainform:current', 'currentAt'], ['jarvis-rainform:forecast', 'hourlyForecast'],
    ] as const) {
      ipcMain.handle(channel, async (event, value: unknown) => {
        if (!this.isTrusted(event) || !value || typeof value !== 'object' || Array.isArray(value)) throw new Error('无效 Rainform 天气请求');
        const { latitude, longitude } = value as Record<string, unknown>;
        if (!Number.isFinite(latitude) || Number(latitude) < -90 || Number(latitude) > 90
          || !Number.isFinite(longitude) || Number(longitude) < -180 || Number(longitude) > 180) throw new Error('Rainform 天气坐标无效');
        return this.getClient()[method](Number(latitude), Number(longitude));
      });
    }
  }

  private async waitForRenderer(window: BrowserWindow): Promise<void> {
    const gate = this.rendererReady;
    if (!gate || gate.window !== window) throw new Error('Jarvis Rainform 窗口未能初始化');
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([gate.promise, new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Rainform 初始化超时')), 45_000);
      })]);
    } finally { if (timer) clearTimeout(timer); }
  }

  private isTrusted(event: IpcMainEvent | IpcMainInvokeEvent): boolean {
    return Boolean(this.window && !this.window.isDestroyed() && event.sender === this.window.webContents
      && event.senderFrame === this.window.webContents.mainFrame);
  }
}
