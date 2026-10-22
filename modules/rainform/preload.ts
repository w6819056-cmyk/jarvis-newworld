import { contextBridge, ipcRenderer } from 'electron';
import type { QWeatherCity, QWeatherCurrent, QWeatherForecast } from '../../electron/qweather';
import type { RainformCommandEnvelope, RainformResponseEnvelope } from './protocol';

const bridge = {
  ready: () => ipcRenderer.send('jarvis-rainform:ready'),
  onCommand(callback: (command: RainformCommandEnvelope) => void) {
    const listener = (_event: Electron.IpcRendererEvent, command: RainformCommandEnvelope) => callback(command);
    ipcRenderer.on('jarvis-rainform:command', listener);
    return () => ipcRenderer.removeListener('jarvis-rainform:command', listener);
  },
  completeCommand(response: RainformResponseEnvelope) { ipcRenderer.send('jarvis-rainform:result', response); },
  searchCities(query: string): Promise<QWeatherCity[]> { return ipcRenderer.invoke('jarvis-rainform:search-cities', query); },
  currentAt(latitude: number, longitude: number): Promise<QWeatherCurrent> { return ipcRenderer.invoke('jarvis-rainform:current', { latitude, longitude }); },
  hourlyForecast(latitude: number, longitude: number): Promise<QWeatherForecast> { return ipcRenderer.invoke('jarvis-rainform:forecast', { latitude, longitude }); },
};

contextBridge.exposeInMainWorld('rainformBridge', bridge);
