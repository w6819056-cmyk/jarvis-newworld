// Exercise the real sandboxed preload and production renderer without Codex or speech playback.
const { app, BrowserWindow, ipcMain, session } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');
app.setPath('userData', path.join(app.getPath('temp'), 'jarvis-audio-check'));
let fixture;
if (process.argv.includes('--fake')) {
  // Pad the spoken fixture with silence so streaming recognition can finish a sentence.
  const original = fs.readFileSync(path.resolve(__dirname, '../runtime/wake-test.wav'));
  let offset = 12, format, pcm;
  while (offset + 8 <= original.length) {
    const name = original.toString('ascii', offset, offset + 4), size = original.readUInt32LE(offset + 4);
    if (name === 'fmt ') format = original.subarray(offset + 8, offset + 8 + size);
    if (name === 'data') pcm = original.subarray(offset + 8, offset + 8 + size);
    offset += 8 + size + (size % 2);
  }
  assert.ok(format && pcm, 'fixture must be a PCM WAV');
  const quiet = process.argv.includes('--quiet');
  if (quiet) {
    assert.equal(format.readUInt16LE(14), 16, 'quiet fixture scaling requires 16-bit PCM');
    pcm = Buffer.from(pcm);
    for (let i = 0; i + 1 < pcm.length; i += 2) pcm.writeInt16LE(Math.round(pcm.readInt16LE(i) * 0.25), i);
  }
  const silence = Buffer.alloc(format.readUInt32LE(8) * 3);
  const header = Buffer.alloc(20 + format.length + 8);
  header.write('RIFF'); header.writeUInt32LE(header.length + pcm.length + silence.length - 8, 4); header.write('WAVEfmt ', 8);
  header.writeUInt32LE(format.length, 16); format.copy(header, 20); header.write('data',20 + format.length); header.writeUInt32LE(pcm.length + silence.length,24 + format.length);
  fixture = path.join(app.getPath('temp'), `jarvis-wake-check-${process.pid}.wav`);
  fs.writeFileSync(fixture, Buffer.concat([header, pcm, silence]));
  app.commandLine.appendSwitch('use-fake-ui-for-media-stream');
  app.commandLine.appendSwitch('use-fake-device-for-media-stream');
  app.commandLine.appendSwitch('use-file-for-fake-audio-capture', fixture);
}
let frames = 0, peak = 0, nearCeiling = 0, trustedFrames = 0, typedFrames = 0;
const recognized = [];
const errors = [];
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { preload: path.resolve(__dirname, '../dist-electron/preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  const worker = new (require('node:worker_threads').Worker)(path.resolve(__dirname, '../dist-electron/asr-worker.cjs'), {workerData:{modelPath:path.resolve(__dirname,'../runtime/models/sherpa-onnx-x-asr-480ms-streaming-zipformer-transducer-zh-en-int8-2026-06-05')}});
  let ready = false;
  worker.on('message', m => {if(m.type === 'ready') ready=true; if(m.type==='result') {recognized.push(m); if(process.argv.includes('--live')) console.log(JSON.stringify(m));} if(m.type==='error') errors.push(m.message)});
  worker.on('error', error => errors.push(String(error)));
  await new Promise((resolve,reject) => { worker.on('message', m => {if(m.type==='ready')resolve(); if(m.type==='error')reject(new Error(m.message));}); worker.on('error',reject); });
  session.defaultSession.setPermissionRequestHandler((c, p, cb) => cb(p === 'media'));
  session.defaultSession.setPermissionCheckHandler((c, p) => p === 'media');
  ipcMain.handle('jarvis:state', () => ({ status:'ready',detail:'test',voiceReady:true,paused:false,busy:false,transcript:'',reply:'',requests:[],settings:{cwd:'',codexPath:''} }));
  ipcMain.handle('jarvis:action', (_, a) => { if (a.type === 'voiceError') errors.push(a.message); });
  ipcMain.on('jarvis:audio', (event, samples) => { frames++; if(event.sender===win.webContents && event.senderFrame===win.webContents.mainFrame) trustedFrames++; if(samples instanceof Float32Array) typedFrames++; for(const x of samples) { const value=Math.abs(x);peak=Math.max(peak,value);if(value>.975)nearCeiling++;} if(ready)worker.postMessage({type:'audio',samples,epoch:0}); });
  win.webContents.on('console-message', (_, details) => { if(details.level === 'error') errors.push(details.message); });
  await win.loadFile(path.resolve(__dirname, '../dist-windows/windows.html'));
  if(process.argv.includes('--live'))console.log('MICROPHONE_READY');
  await new Promise(resolve => setTimeout(resolve, process.argv.includes('--live') ? 60000 : 10000));
  const info = await win.webContents.executeJavaScript(`(async()=>{const s=await navigator.mediaDevices.getUserMedia({audio:true}); const selected=s.getAudioTracks()[0].label; s.getTracks().forEach(t=>t.stop()); return {status:document.querySelector('#status').textContent, selected, inputs:(await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind==='audioinput').map(d=>({id:d.deviceId,label:d.label}))};})()`);
  const captured = frames;
  const capturedPeak = peak;
  await win.webContents.executeJavaScript(`window.jarvis.audio(new Float32Array([0.25,0.5]))`);
  await new Promise(resolve => setTimeout(resolve, 100));
  console.log(JSON.stringify({info,captured,bridgeFrames:frames-captured,trustedFrames,typedFrames,capturedPeak,nearCeilingSamples:nearCeiling,recognized,errors}));
  let code = 0;
  try {
    assert.ok(frames-captured>=1,'renderer Float32Array must cross contextBridge'); assert.equal(trustedFrames,frames); assert.equal(typedFrames,frames); assert.ok(captured>10,'AudioWorklet must deliver frames without clicking'); assert.deepEqual(errors,[]);
    if(fixture) { assert.ok(capturedPeak>0,'fixture must reach the worklet'); assert.ok(recognized.some(r=>r.final && /维斯/.test(r.text) && /打开浏览器/.test(r.text)), 'wake phrase and command must reach final recognition'); if(process.argv.includes('--quiet'))assert.ok(nearCeiling/Math.max(1,captured*1600)<.03,'adaptive gain must not hard-clip a significant portion of quiet speech'); }
  }
  catch(error) { console.error(error.message); code=1; }
  await worker.terminate(); win.destroy(); if(fixture)fs.unlinkSync(fixture); app.exit(code);
}).catch(error => { console.error(error); app.exit(1); });
