import { contextBridge, ipcRenderer } from 'electron';
import type { MapCommandEnvelope, MapResponseEnvelope } from './protocol';

export type HoloMapBridge = {
  getConfig(): Promise<{ amapJsApiKey: string; amapSecurityCode: string }>;
  ready(): void;
  onCommand(callback: (command: MapCommandEnvelope) => void): () => void;
  completeCommand(response: MapResponseEnvelope): void;
};

const bridge: HoloMapBridge = {
  getConfig: () => ipcRenderer.invoke('jarvis-map:config'),
  ready: () => ipcRenderer.send('jarvis-map:ready'),
  onCommand(callback) {
    const listener = (_event: Electron.IpcRendererEvent, command: MapCommandEnvelope) => callback(command);
    ipcRenderer.on('jarvis-map:command', listener);
    return () => ipcRenderer.removeListener('jarvis-map:command', listener);
  },
  completeCommand(response) {
    ipcRenderer.send('jarvis-map:result', response);
  },
};

contextBridge.exposeInMainWorld('holoMap', bridge);
