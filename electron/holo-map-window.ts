import { app, BrowserWindow, ipcMain, session, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { MapCommandEnvelope, MapResponseEnvelope } from '../modules/holo-map/protocol';
import type { MapWindowHost } from '../modules/holo-map/controller';

const partitionName = 'persist:jarvis-holo-map';

export class ElectronHoloMapWindow implements MapWindowHost {
  private window?: BrowserWindow;
  private rendererReady?: { window: BrowserWindow; promise: Promise<void>; resolve(): void; reject(error: Error): void };
  private resultHandlers = new Set<(trusted: boolean, response: MapResponseEnvelope) => void>();
  private closedHandlers = new Set<() => void>();
  private ipcReady = false;

  constructor(private readonly getConfig: () => { amapJsApiKey: string; amapSecurityCode: string }) {}

  async open(): Promise<void> {
    this.installIpc();
    if (this.window && !this.window.isDestroyed()) {
      if (this.window.isMinimized()) this.window.restore();
      await this.waitForRenderer(this.window);
      return;
    }
    const mapSession = session.fromPartition(partitionName);
    mapSession.setPermissionRequestHandler((contents, permission, callback) => {
      callback(contents === this.window?.webContents && permission === 'geolocation');
    });
    mapSession.setPermissionCheckHandler((contents, permission) => contents === this.window?.webContents && permission === 'geolocation');

    const window = new BrowserWindow({
      width: 1440,
      height: 900,
      minWidth: 960,
      minHeight: 640,
      show: false,
      autoHideMenuBar: true,
      title: 'Jarvis 地图',
      backgroundColor: '#050b12',
      webPreferences: {
        preload: path.join(__dirname, 'holo-map-preload.cjs'),
        session: mapSession,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
      },
    });
    this.window = window;
    let resolveReady!: () => void;
    let rejectReady!: (error: Error) => void;
    const readyPromise = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
    this.rendererReady = { window, promise: readyPromise, resolve: resolveReady, reject: rejectReady };
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    const pagePath = path.join(app.getAppPath(), 'dist-windows', 'modules', 'holo-map', 'index.html');
    const pageUrl = pathToFileURL(pagePath).href;
    window.webContents.on('will-navigate', (event, url) => {
      if (url !== pageUrl) event.preventDefault();
    });
    window.on('closed', () => {
      if (this.window === window) this.window = undefined;
      if (this.rendererReady?.window === window) {
        this.rendererReady.reject(new Error('地图窗口在初始化前已关闭'));
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
      throw new Error(`Jarvis 地图模块加载失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  focus(): void {
    if (!this.window || this.window.isDestroyed()) return;
    if (this.window.isMinimized()) this.window.restore();
    this.window.show();
    this.window.focus();
  }

  send(command: MapCommandEnvelope): void {
    if (!this.window || this.window.isDestroyed() || this.window.webContents.isLoading()) throw new Error('地图窗口尚未就绪');
    this.window.webContents.send('jarvis-map:command', command);
  }

  onResult(handler: (trusted: boolean, response: MapResponseEnvelope) => void): () => void {
    this.resultHandlers.add(handler);
    return () => this.resultHandlers.delete(handler);
  }

  onClosed(handler: () => void): () => void {
    this.closedHandlers.add(handler);
    return () => this.closedHandlers.delete(handler);
  }

  close(): void {
    if (this.window && !this.window.isDestroyed()) this.window.close();
  }

  private installIpc(): void {
    if (this.ipcReady) return;
    this.ipcReady = true;
    ipcMain.handle('jarvis-map:config', event => {
      if (!this.isTrusted(event)) throw new Error('无效地图窗口');
      return this.getConfig();
    });
    ipcMain.on('jarvis-map:ready', event => {
      if (!this.isTrusted(event) || !this.rendererReady || this.rendererReady.window !== this.window) return;
      this.rendererReady.resolve();
    });
    ipcMain.on('jarvis-map:result', (event, value: unknown) => {
      if (!this.isTrusted(event) || !value || typeof value !== 'object' || Array.isArray(value)) return;
      const response = value as MapResponseEnvelope;
      for (const handler of this.resultHandlers) handler(true, response);
    });
  }

  private async waitForRenderer(window: BrowserWindow): Promise<void> {
    const gate = this.rendererReady;
    if (!gate || gate.window !== window) throw new Error('Jarvis 地图窗口未能初始化');
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        gate.promise,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error('地图初始化超时，请检查高德配置和网络连接')), 45_000);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private isTrusted(event: IpcMainEvent | IpcMainInvokeEvent): boolean {
    return Boolean(this.window && !this.window.isDestroyed() && event.sender === this.window.webContents && event.senderFrame === this.window.webContents.mainFrame);
  }
}
