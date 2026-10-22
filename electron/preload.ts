import { contextBridge, ipcRenderer } from 'electron';
import type { Bridge } from './protocol';
const bridge: Bridge = {
  getState: () => ipcRenderer.invoke('jarvis:state'),
  action: action => ipcRenderer.invoke('jarvis:action', action),
  audio: samples => {
    // Typed-array identity is not stable across Electron's isolated worlds.
    // Validate the shape instead of using instanceof before crossing IPC.
    if (ArrayBuffer.isView(samples) && samples.BYTES_PER_ELEMENT === 4 && samples.byteLength <= 32000) {
      // Send plain numbers across IPC; Electron versions differ in how they
      // clone typed arrays between the isolated renderer and main process.
      ipcRenderer.send('jarvis:audio', Array.from(samples));
    }
  },
  setInteractive: value => { if (typeof value === 'boolean') ipcRenderer.send('jarvis:interactive', value); },
  startCodexVoice: (sdp, voice) => ipcRenderer.invoke('jarvis:codex-voice-start', { sdp, voice }),
  stopCodexVoice: () => ipcRenderer.invoke('jarvis:codex-voice-stop'),
  appendCodexVoiceText: text => ipcRenderer.invoke('jarvis:codex-voice-text', text),
  archive: request => ipcRenderer.invoke('jarvis:archive', request),
  onCodexVoiceEvent: callback => { const handler = (_: unknown, event: any) => callback(event); ipcRenderer.on('jarvis:codex-voice-event', handler); return () => ipcRenderer.removeListener('jarvis:codex-voice-event', handler); },
  onDoubaoAudio: callback => { const handler = (_: unknown, audio: Uint8Array) => callback(audio); ipcRenderer.on('jarvis:doubao-audio', handler); return () => ipcRenderer.removeListener('jarvis:doubao-audio', handler); },
  onState: callback => { const handler = (_: unknown, state: any) => callback(state); ipcRenderer.on('jarvis:state', handler); return () => ipcRenderer.removeListener('jarvis:state', handler); },
  onSignal: callback => { const handler = (_: unknown, signal: any) => callback(signal); ipcRenderer.on('jarvis:signal', handler); return () => ipcRenderer.removeListener('jarvis:signal', handler); },
};
contextBridge.exposeInMainWorld('jarvis', bridge);
