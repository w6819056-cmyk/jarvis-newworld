import './style.css';
import './windows.css';
import 'leaflet/dist/leaflet.css';
import * as THREE from 'three';
import L from 'leaflet';
import { attachWindowsVisuals } from './windows-visuals';
import type { Action, AssistantState, Bridge, PendingRequest, WeatherDisplay } from '../electron/protocol';
import { HelmetScene, type ArmorDisplayMode } from './helmet/helmet-scene';
import { ArmorInspection, shouldApplyGestureStatus } from './armor-inspection';
import { GestureCamera, type GestureModeStatus, type GesturePreviewFrame } from './gesture/gesture-camera';
import { ArmorGestureController, type ArmorGestureAction, type GestureHand } from './gesture/armor-gesture-controller';
import type { PointDirection } from './gesture/hand-gesture';
import { AssemblyAudio } from './helmet/assembly-audio';
import { extractCodexSdpAnswer, waitForIceGathering } from './codex-voice';
import { CodexVoiceHud } from './codex-voice-hud';
import { HudResults } from './hud-results';
import { submitCommandInput } from './command-input';
declare global {
  interface Window {
    jarvis?: Bridge;
    jarvisVisualCheck?: {
      setMode(mode: ArmorDisplayMode): void;
      select(direction: PointDirection): string | undefined;
      confirm(): void;
      restore(): void;
    };
  }
}

const api = window.jarvis;
const assemblyAudio = new AssemblyAudio();
const hudResults = new HudResults();
const codexVoiceHud = new CodexVoiceHud(hudResults);
const workBgm = new Audio('./audio/back-in-black.mp3');
workBgm.loop = true;
workBgm.volume = 0.35;
document.querySelector('#app')!.innerHTML = `
<main class="shell windows-shell" data-mode="booting">
  <canvas id="particle-field" aria-hidden="true"></canvas>
  <div class="stage"><div class="avatar-window"><div class="character-aura"></div>
    <div class="character-rig" role="button" tabindex="0" aria-label="显示或收起控制栏" aria-expanded="false" aria-controls="desktop-toolbar desktop-controls desktop-status" title="点击显示控制栏；说“嗨贾维斯”或“Hi Jarvis”唤醒">
      <div class="assembly-orbits" aria-hidden="true"><i></i><i></i><i></i></div>
      <div class="armor-shards" aria-hidden="true"></div>
      <img id="jarvis-character" class="helmet-character" src="./assets/jarvis-character-v2.png" alt="贾维斯钢铁侠装甲模型" draggable="false">
      <div class="helmet-scan" aria-hidden="true"></div><div class="assembly-flash" aria-hidden="true"></div>
    </div></div></div>
  <header id="desktop-toolbar" class="win-toolbar"><button id="history" title="查看对话" aria-label="查看对话">☰</button><span class="win-brand">JARVIS</span><button id="gesture-toggle" class="gesture-toggle" type="button" aria-label="开启手势模式" aria-pressed="false" title="开启或关闭摄像头手势模式"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="6" width="13" height="12" rx="2"/><path d="m16 10 5-3v10l-5-3z"/></svg><span>手势</span></button><button id="settings" title="设置" aria-label="设置">⚙ 设置</button><button id="minimize" title="最小化，继续监听" aria-label="最小化">−</button><button id="exit" title="退出并关闭麦克风" aria-label="退出">×</button></header>
  <div id="gesture-indicator" class="gesture-indicator" role="status" hidden><i></i><span id="gesture-status"></span><b id="gesture-mode" hidden></b><b id="gesture-selected" hidden></b></div>
  <aside id="gesture-preview" class="gesture-preview" aria-label="摄像头手势识别画面" hidden>
    <header><span><i></i>识别画面</span><button id="gesture-preview-collapse" type="button" aria-expanded="true" aria-label="收起识别画面">−</button></header>
    <div class="gesture-preview-content">
      <div id="gesture-preview-viewport" class="gesture-preview-viewport"><canvas id="gesture-preview-overlay" aria-hidden="true"></canvas><span id="gesture-preview-empty">等待摄像头画面</span></div>
      <div id="gesture-preview-hands" class="gesture-preview-hands"><span>等待识别手部</span></div>
      <div class="gesture-preview-head"><span>头部</span><b id="gesture-preview-direction">未识别</b></div>
      <div id="gesture-preview-mode" class="gesture-preview-mode">模式 1：头部方向仅显示</div>
    </div>
  </aside>
  <div id="desktop-status" class="win-caption" role="status"><i></i><span id="status">正在启动</span></div>
  <aside id="live-transcript" class="win-live-transcript" aria-label="本次识别内容">
    <span>本次识别</span><p id="live-transcript-text">等待语音…</p>
  </aside>
  <aside id="hud-results" class="win-hud-stack" aria-label="贾维斯结果" hidden><div id="hud-results-list" class="win-hud-list"></div></aside>
  <footer id="desktop-controls" class="win-controls">
    <button id="mic" class="win-round" title="暂停监听" aria-label="暂停监听"><svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="12" rx="3"/><path d="M6 10v2a6 6 0 0 0 12 0v-2M12 18v3m-4 0h8"/></svg></button>
    <form id="command" class="win-command"><input id="text" maxlength="20000" placeholder="输入指令后按 Enter 或点击发送…" aria-label="指令" autocomplete="off"><button type="submit" aria-label="发送指令" title="发送指令">↑</button></form>
    <button id="stop" class="win-round win-stop" title="停止任务（Ctrl+Shift+空格）" aria-label="停止任务"><svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2"/></svg></button>
  </footer>
  <section id="conversation" class="win-conversation" hidden aria-label="对话与记忆"><header>对话与记忆<button id="close-history" aria-label="关闭对话">×</button></header><nav class="archive-tabs"><button id="archive-tab-history" type="button" aria-pressed="true">聊天记录</button><button id="archive-tab-memories" type="button" aria-pressed="false">长期记忆</button></nav><form id="archive-search"><input id="archive-query" maxlength="2000" placeholder="搜索本地文字记录…" aria-label="搜索本地文字记录"><button type="submit" aria-label="搜索">⌕</button></form><div class="archive-actions"><button id="archive-clear" type="button">清空聊天记录</button></div><div id="archive-results" class="archive-results" role="status" aria-live="polite">正在加载</div><hr><label>本轮你说</label><p id="transcript">—</p><label>贾维斯回复</label><p id="reply">说“嗨贾维斯”，然后告诉我需要做什么。</p></section>
  <dialog id="settings-dialog" class="win-dialog"><h2>贾维斯设置</h2><p>打开软件、搜索、普通输入直接执行。更改用户文件前，会先向你确认。</p><label>语音引擎<select id="voice-provider"><option value="local">本地语音</option><option value="codex">Codex Voice</option><option value="doubao">豆包语音</option></select></label><label>工作目录<input id="cwd" spellcheck="false" autocomplete="off"></label><label>Codex 程序位置 <small>留空自动查找</small><input id="codex-path" spellcheck="false" autocomplete="off"></label><label>Mineradio.exe 位置<input id="mineradio-path" spellcheck="false" autocomplete="off" placeholder="填写 Mineradio.exe 完整路径"></label><label class="doubao-setting">豆包 API Key<input id="doubao-api-key" type="password" spellcheck="false" autocomplete="off"></label><label class="doubao-setting">豆包 ASR 资源标识<input id="doubao-asr-resource" spellcheck="false" autocomplete="off"></label><label class="doubao-setting">豆包 TTS 资源标识<input id="doubao-tts-resource" spellcheck="false" autocomplete="off"></label><label class="doubao-setting">豆包音色<input id="doubao-voice-type" spellcheck="false" autocomplete="off" placeholder="可选"></label><label class="map-setting">高德地图 JS API Key<input id="amap-js-key" type="password" spellcheck="false" autocomplete="off"></label><label class="map-setting">高德地图安全密钥<input id="amap-security-code" type="password" spellcheck="false" autocomplete="off"></label><label>和风天气 API Host <small>例如：租户标识.xy.qweatherapi.com</small><input id="qweather-api-host" spellcheck="false" autocomplete="off"></label><label>和风天气 API Key<input id="qweather-api-key" type="password" spellcheck="false" autocomplete="off"></label><p id="voice-note">本地唤醒与识别 · Windows 中文声音播报</p><p id="thread-note"></p><div class="win-settings-row"><button id="retry-voice">重新加载语音</button><button id="new-thread">新对话</button><button id="test-voice">试听声音</button></div><p class="win-note">停止快捷键：Ctrl + Shift + 空格。关闭窗口会退出软件；最小化后继续监听。</p><div class="win-dialog-actions"><button id="close-settings">关闭</button><button id="save-settings" class="primary">保存</button></div></dialog>
  <dialog id="request-dialog" class="win-dialog"><h2 id="request-title">需要你的确认</h2><p id="request-note">请说“确认”或“取消”，也可以点击按钮。</p><pre id="request-details"></pre><form id="request-form"><div id="questions"></div><div class="win-dialog-actions"><button type="button" id="deny">拒绝</button><button type="submit" class="primary" id="allow">允许一次</button></div></form></dialog>
  <div id="toast" class="win-toast" role="alert" hidden></div>
</main>`;
const $ = <T extends HTMLElement>(s: string) => document.querySelector<T>(s)!;
const shell = $<HTMLElement>('.shell');
const visuals = attachWindowsVisuals(shell);
let helmetScene: HelmetScene | undefined;
let gestureCamera: GestureCamera | undefined;
let inspection: ArmorInspection | undefined;
const gestureController = new ArmorGestureController();
let gestureStatus: GestureModeStatus = 'off';
let cameraRequested = false;
const settings = $<HTMLDialogElement>('#settings-dialog');
const requestDialog = $<HTMLDialogElement>('#request-dialog');
let state: AssistantState;
let currentHudId: number | undefined;
let wasBusy = false;
let currentRequest: PendingRequest | undefined;
let shownRequest = '';
let lastSpoken = '';
let awaitingReply = false;
let stream: MediaStream | undefined;
let context: AudioContext | undefined;
let capture: AudioWorkletNode | undefined;
let micStarting = false;
let micGeneration = 0;
let toastTimer: ReturnType<typeof setTimeout>;
let level = 0;
let previewVideo: HTMLVideoElement | undefined;
let previewHands: readonly GestureHand[] = [];
let codexPeer: RTCPeerConnection | undefined;
let codexStream: MediaStream | undefined;
let codexAudio: HTMLAudioElement | undefined;
let codexStarting = false;
let doubaoPlaybackContext: AudioContext | undefined;
let doubaoNextPlaybackTime = 0;

function toast(text: string) { $('#toast').textContent = text; $('#toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').hidden = true, 7000); }
async function action(value: Action) {
  if (!api) { toast('这是界面预览，请运行 Windows 桌面版本使用语音和本地操作。'); return false; }
  try { await api.action(value); return true; } catch (error) { toast(String(error).replace(/^Error:.*?: /, '')); return false; }
}
const helmet = $<HTMLElement>('.character-rig');
const hudStack = $<HTMLElement>('#hud-results');
const hudList = $<HTMLElement>('#hud-results-list');
const hudCards = new Map<number, HTMLElement>();
const weatherMaps = new Map<number, L.Map>();
function weatherKey(weather: WeatherDisplay | undefined): string {
  if (!weather) return '';
  return [weather.city, weather.country ?? '', weather.latitude, weather.longitude, weather.temperature, weather.feelsLike ?? '', weather.humidity ?? '', weather.windSpeed ?? '', weather.weatherCode, weather.condition, weather.updatedAt ?? '', weather.locationMode].join('|');
}
function weatherIcon(code: number): string {
  if (code === 0 || code === 1) return '☀';
  if (code === 2 || code === 3) return '☁';
  if ([45, 48].includes(code)) return '〰';
  if ([71, 73, 75, 77, 85, 86].includes(code)) return '❄';
  if ([95, 96, 99].includes(code)) return 'ϟ';
  return '☂';
}
function createWeatherCard(card: HTMLElement, weather: WeatherDisplay): void {
  card.classList.add('win-weather-card');
  const body = card.querySelector('p');
  if (!body) return;
  body.remove();
  const content = document.createElement('div');
  content.className = 'weather-content';
  const mapFrame = document.createElement('div');
  mapFrame.className = 'weather-map-frame';
  const map = document.createElement('div');
  map.className = 'weather-map';
  map.setAttribute('aria-label', `${weather.city}地图定位`);
  const mapStatus = document.createElement('span');
  mapStatus.className = 'weather-map-status';
  mapStatus.textContent = '地图加载中…';
  mapStatus.setAttribute('role', 'status');
  mapFrame.append(map, mapStatus);
  const summary = document.createElement('div');
  summary.className = 'weather-summary';
  summary.innerHTML = `<div class="weather-location"><span>${weather.locationMode === 'current' ? '当前位置' : '查询位置'}</span><strong></strong></div><div class="weather-main"><span class="weather-icon" aria-hidden="true"></span><b class="weather-temperature"></b></div><div class="weather-condition"></div><div class="weather-details"></div>`;
  (summary.querySelector('.weather-location strong') as HTMLElement).textContent = weather.city;
  (summary.querySelector('.weather-icon') as HTMLElement).textContent = weatherIcon(weather.weatherCode);
  (summary.querySelector('.weather-temperature') as HTMLElement).textContent = `${weather.temperature}°C`;
  (summary.querySelector('.weather-condition') as HTMLElement).textContent = weather.condition;
  const details = [`体感 ${weather.feelsLike ?? '--'}°C`, `湿度 ${weather.humidity ?? '--'}%`, `风速 ${weather.windSpeed ?? '--'} km/h`];
  (summary.querySelector('.weather-details') as HTMLElement).textContent = details.join(' · ');
  content.append(mapFrame, summary);
  card.append(content);
}
function initializeWeatherMap(card: HTMLElement, weather: WeatherDisplay): void {
  const map = card.querySelector<HTMLElement>('.weather-map');
  const status = card.querySelector<HTMLElement>('.weather-map-status');
  if (!map || !status) return;
  requestAnimationFrame(() => {
    if (!card.isConnected) return;
    let instance: L.Map;
    try {
      instance = L.map(map, { zoomControl: false, attributionControl: true, scrollWheelZoom: false }).setView([weather.latitude, weather.longitude], 10);
    } catch {
      status.textContent = '地图初始化失败';
      return;
    }
    const setStatus = (text: string) => {
      status.textContent = text;
      status.hidden = !text;
    };
    const tiles = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' });
    tiles.on('load', () => setStatus(''));
    tiles.on('tileerror', () => setStatus('地图加载失败，请检查网络'));
    tiles.addTo(instance);
    L.circleMarker([weather.latitude, weather.longitude], { radius: 8, color: '#7de8ff', fillColor: '#20c7ff', fillOpacity: .9, weight: 2 }).addTo(instance);
    const id = Number(card.dataset.hudId);
    weatherMaps.set(id, instance);
    instance.invalidateSize({ animate: false });
  });
}
function createHudCard(item: { id: number; text: string; pending: boolean; weather?: WeatherDisplay }): HTMLElement {
  const card = document.createElement('article');
  card.className = 'win-hud-card';
  card.dataset.pending = String(item.pending);
  card.dataset.hudId = String(item.id);
  const header = document.createElement('header');
  const title = document.createElement('span');
  title.textContent = 'JARVIS // RESULT';
  const close = document.createElement('button');
  close.type = 'button';
  close.dataset.hudClose = String(item.id);
  close.setAttribute('aria-label', '关闭此结果');
  close.title = '关闭此结果';
  close.textContent = '×';
  header.append(title, close);
  const body = document.createElement('p');
  body.textContent = item.text || (item.pending ? '正在处理…' : '处理完成');
  card.append(header, body);
  if (item.weather) createWeatherCard(card, item.weather);
  return card;
}
function renderHudResults() {
  const items = hudResults.items();
  hudStack.hidden = items.length === 0;
  const ids = new Set(items.map(item => item.id));
  for (const [id, card] of hudCards) if (!ids.has(id)) { weatherMaps.get(id)?.remove(); weatherMaps.delete(id); card.remove(); hudCards.delete(id); }
  for (const item of items) if (!hudCards.has(item.id)) {
    const card = createHudCard(item);
    hudCards.set(item.id, card);
    hudList.append(card);
    if (item.weather) initializeWeatherMap(card, item.weather);
  }
}
function updateCurrentHud(text: string, pending: boolean) {
  if (currentHudId === undefined) return;
  hudResults.update(currentHudId, text, pending);
  const card = hudCards.get(currentHudId);
  if (!card) return;
  card.dataset.pending = String(pending);
  const body = card.querySelector('p');
  if (body) body.textContent = text || (pending ? '正在处理…' : '处理完成');
}
function updateCurrentWeather(weather: WeatherDisplay): void {
  if (currentHudId === undefined) return;
  hudResults.updateWeather(currentHudId, weather);
  const existing = hudCards.get(currentHudId);
  if (existing) { existing.remove(); hudCards.delete(currentHudId); weatherMaps.get(currentHudId)?.remove(); weatherMaps.delete(currentHudId); }
  renderHudResults();
}
hudStack.addEventListener('click', event => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-hud-close]');
  if (!button) return;
  const id = Number(button.dataset.hudClose);
  if (!Number.isSafeInteger(id)) return;
  hudResults.close(id);
  weatherMaps.get(id)?.remove();
  weatherMaps.delete(id);
  renderHudResults();
});
const gestureButton = $<HTMLButtonElement>('#gesture-toggle');
const gestureIndicator = $<HTMLElement>('#gesture-indicator');
function updateGestureReadout() {
  const active = gestureStatus === 'tracking' && inspection?.active === true;
  const mode = $('#gesture-mode');
  const selected = $('#gesture-selected');
  mode.hidden = !active;
  mode.textContent = `模式 ${helmetScene?.modeNumber ?? 1}`;
  const label = helmetScene?.selectedPartLabel ?? '';
  selected.hidden = !active || helmetScene?.modeNumber !== 3 || !label;
  selected.textContent = label;
  updatePreviewMode();
}
function updatePreviewMode(): void {
  const mode = helmetScene?.modeNumber ?? 1;
  $('#gesture-preview-mode').textContent = mode === 3
    ? '模式 3：头部选件，右手 OK 确认，左拳拖动，右拳复位'
    : `模式 ${mode}：头部方向仅显示，左手举 3 指切到模式 3`;
}
function updateGestureStatus(status: GestureModeStatus, detail = '') {
  if (!shouldApplyGestureStatus(cameraRequested, status)) return;
  if (status === 'off' || status === 'error') cameraRequested = false;
  gestureStatus = status;
  gestureButton.setAttribute('aria-pressed', String(status === 'tracking' || status === 'requesting'));
  gestureButton.setAttribute('aria-label', status === 'tracking' ? '关闭手势模式' : '开启手势模式');
  gestureIndicator.hidden = status === 'off';
  $('#gesture-preview').hidden = status === 'off' || !inspection?.active;
  gestureIndicator.dataset.state = status;
  $('#gesture-status').textContent = status === 'requesting' ? '正在连接摄像头' : status === 'tracking' ? '摄像头手势识别中' : detail || '手势模式无法使用';
  if (status === 'error') {
    gestureController.reset(helmetScene?.modeNumber ?? 1);
    helmetScene?.setDispersal(0);
    if (inspection?.active) updateGesturePreview({ hands: [] });
  }
  updateGestureReadout();
}
const previewCanvas = $<HTMLCanvasElement>('#gesture-preview-overlay');
const previewContext = previewCanvas.getContext('2d');
const handConnections: ReadonlyArray<readonly [number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12], [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [0, 17], [17, 18], [18, 19], [19, 20],
];
const poseLabels: Record<GestureHand['pose'], string> = { open: '张开手掌', fist: '握拳', neutral: '姿势未确定', lost: '未检测到' };
const directionLabels = { up: '上', down: '下', left: '左', right: '右' } as const;
function resizePreviewCanvas(width: number, height: number): void {
  const ratio = Math.min(1.5, devicePixelRatio || 1);
  const pixelWidth = Math.round(width * ratio);
  const pixelHeight = Math.round(height * ratio);
  if (previewCanvas.width !== pixelWidth || previewCanvas.height !== pixelHeight) {
    previewCanvas.width = pixelWidth;
    previewCanvas.height = pixelHeight;
  }
  previewContext?.setTransform(ratio, 0, 0, ratio, 0, 0);
}
function drawHandNodes(hands: readonly GestureHand[]): void {
  const width = previewCanvas.clientWidth;
  const height = previewCanvas.clientHeight;
  if (!previewContext || !width || !height) return;
  resizePreviewCanvas(width, height);
  previewContext.clearRect(0, 0, width, height);
  for (const hand of hands) {
    const points = hand.landmarks;
    if (points.length !== 21) continue;
    previewContext.lineWidth = 2;
    previewContext.strokeStyle = hand.handedness === 'Left' ? '#29d9ff' : '#ffb24d';
    previewContext.fillStyle = previewContext.strokeStyle;
    for (const [start, end] of handConnections) {
      const a = points[start]!, b = points[end]!;
      previewContext.beginPath();
      previewContext.moveTo((1 - a.x) * width, a.y * height);
      previewContext.lineTo((1 - b.x) * width, b.y * height);
      previewContext.stroke();
    }
    for (let index = 0; index < points.length; index++) {
      const point = points[index]!;
      const radius = [0, 4, 8, 12, 16, 20].includes(index) ? 3.5 : 2.4;
      previewContext.beginPath();
      previewContext.arc((1 - point.x) * width, point.y * height, radius, 0, Math.PI * 2);
      previewContext.fill();
    }
  }
}
function handLabel(hand: GestureHand): string {
  const pose = hand.pose === 'fist' ? '握拳' : hand.okGesture ? 'OK 手势' : hand.pinching ? '拇指食指捏合' : poseLabels[hand.pose];
  return `${hand.handedness === 'Left' ? '左手' : '右手'} · ${pose} · ${hand.fingerCount} 指`;
}
function updatePreviewHands(hands: readonly GestureHand[]): void {
  previewHands = hands;
  const container = $<HTMLElement>('#gesture-preview-hands');
  if (!hands.length) {
    container.replaceChildren(Object.assign(document.createElement('span'), { textContent: '未检测到手部' }));
    return;
  }
  container.replaceChildren(...hands.map(hand => {
    const label = document.createElement('span');
    label.className = `gesture-preview-hand gesture-preview-${hand.handedness.toLowerCase()}`;
    label.textContent = handLabel(hand);
    return label;
  }));
}
function updateGesturePreview(frame: GesturePreviewFrame): void {
  const viewport = $<HTMLElement>('#gesture-preview-viewport');
  const previewPanel = $('#gesture-preview');
  if (frame.video) {
    previewPanel.dataset.camera = 'on';
    if (previewVideo !== frame.video) {
      previewVideo?.remove();
      previewVideo = frame.video;
      previewVideo.className = 'gesture-preview-video';
      viewport.prepend(previewVideo);
    }
    $('#gesture-preview-empty').hidden = frame.video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA;
  } else {
    previewPanel.dataset.camera = 'off';
    previewVideo?.remove();
    previewVideo = undefined;
    $('#gesture-preview-empty').hidden = false;
    $('#gesture-preview-empty').textContent = gestureStatus === 'error' ? '摄像头或识别器不可用' : '等待摄像头画面';
  }
  updatePreviewHands(frame.hands);
  drawHandNodes(frame.hands);
  $('#gesture-preview-direction').textContent = frame.headDirection ? `向${directionLabels[frame.headDirection]}` : '未识别';
  updatePreviewMode();
}
$('#gesture-preview-collapse').onclick = event => {
  event.stopPropagation();
  const panel = $('#gesture-preview');
  const collapsed = panel.classList.toggle('is-collapsed');
  const button = $<HTMLButtonElement>('#gesture-preview-collapse');
  button.setAttribute('aria-expanded', String(!collapsed));
  button.setAttribute('aria-label', collapsed ? '展开识别画面' : '收起识别画面');
  button.textContent = collapsed ? '+' : '−';
};
window.addEventListener('resize', () => drawHandNodes(previewHands));
function applyGestureAction(action: ArmorGestureAction): void {
  switch (action.type) {
    case 'mode-change':
      helmetScene?.resetAll(true);
      helmetScene?.setMode(action.mode);
      updateGestureReadout();
      void speak(action.announcement).catch(error => toast(`模式播报失败：${String(error)}`));
      break;
    case 'disperse': helmetScene?.setDispersal(action.value ? 1 : 0, action.scope); break;
    case 'rotate': helmetScene?.rotateBy(action.deltaX); break;
    case 'face-forward': helmetScene?.faceForward(); break;
    case 'select-direction': helmetScene?.selectDirection(action.direction); updateGestureReadout(); break;
    case 'confirm-selection': helmetScene?.confirmSelection(); updateGestureReadout(); break;
    case 'drag-start': helmetScene?.startSelectedDrag(new THREE.Vector2(action.point.x, action.point.y)); break;
    case 'drag-move': helmetScene?.moveSelectedDrag(new THREE.Vector2(action.point.x, action.point.y)); break;
    case 'drag-end': helmetScene?.endSelectedDrag(); break;
    case 'reset-all': helmetScene?.restoreSequentially(); updateGestureReadout(); break;
  }
}
async function startGestureCamera(): Promise<void> {
  if (!gestureCamera) throw new Error('摄像头手势模式不可用');
  void assemblyAudio.unlock();
  cameraRequested = true;
  try {
    await gestureCamera.start((hands, nowMs, headDirection) => {
      for (const gestureAction of gestureController.update(hands, nowMs, headDirection)) applyGestureAction(gestureAction);
    }, updateGesturePreview);
  } catch (error) {
    cameraRequested = false;
    throw error;
  }
}
function stopGestureCamera(): void {
  cameraRequested = false;
  gestureCamera?.stop();
}
try {
  helmetScene = new HelmetScene(
    shell,
    () => {},
    error => {
      gestureButton.disabled = true;
      updateGestureStatus('error', `钢铁侠模型加载失败：${error.message}`);
    },
    tier => { void assemblyAudio.play(tier); },
  );
  gestureCamera = new GestureCamera({ onStatus: updateGestureStatus });
  inspection = new ArmorInspection({
    setVisible: visible => {
      helmetScene?.setVisible(visible);
      helmetScene?.setInspectionMode(visible);
      shell.classList.toggle('inspection-active', visible);
      const character = $('#jarvis-character');
      character.classList.toggle('is-3d-hidden', visible);
    },
    startCamera: startGestureCamera,
    stopCamera: stopGestureCamera,
    resetGestures: () => { gestureController.reset(); helmetScene?.setMode(1); updateGestureReadout(); },
    setDispersal: value => helmetScene?.setDispersal(value),
  });
} catch (error) {
  gestureButton.disabled = true;
  updateGestureStatus('error', `3D 头盔不可用：${String(error)}`);
}
if (new URLSearchParams(location.search).get('visualCheck') === '1') {
  window.jarvisVisualCheck = {
    setMode: mode => { helmetScene?.setVisible(true); helmetScene?.setMode(mode); updateGestureReadout(); },
    select: direction => helmetScene?.selectDirection(direction),
    confirm: () => helmetScene?.confirmSelection(),
    restore: () => helmetScene?.restoreSequentially(),
  };
}
gestureButton.onclick = async event => {
  event.stopPropagation();
  if (!helmetScene || !gestureCamera) return;
  if (!inspection?.active) {
    try { await inspection?.enter(); }
    catch (error) { if (inspection?.active) toast(`手势模式无法开启：${error instanceof Error ? error.message : String(error)}`); }
    return;
  }
  if (gestureStatus === 'tracking' || gestureStatus === 'requesting') {
    stopGestureCamera();
    gestureController.reset(helmetScene.modeNumber);
    helmetScene.setDispersal(0);
    return;
  }
  try {
    await startGestureCamera();
  } catch (error) {
    if (!inspection?.active) return;
    const message = error instanceof Error ? error.message : String(error);
    updateGestureStatus('error', '摄像头无法启动');
    toast(`手势模式无法开启：${message}`);
  }
};
function toggleControls() {
  const visible = shell.classList.toggle('controls-visible');
  helmet.setAttribute('aria-expanded', String(visible));
  if (!visible) { $('#conversation').hidden = true; helmet.focus({ preventScroll: true }); }
  syncInteractive();
}
helmet.onclick = toggleControls;
helmet.onkeydown = event => {
  if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); if (!event.repeat) toggleControls(); }
};
let pointerX = -1, pointerY = -1, interactive: boolean | undefined;
function syncInteractive() {
  const hit = document.elementFromPoint(pointerX, pointerY);
  const next = !!document.querySelector('dialog[open]') || !!hit?.closest('.win-toolbar,.win-controls,.win-caption,.gesture-preview:not([hidden]),.character-rig,.win-conversation:not([hidden]),.win-toast:not([hidden]),.win-hud-stack:not([hidden])');
  if (interactive !== next) { interactive = next; api?.setInteractive(next); }
}
document.addEventListener('pointermove', event => { pointerX = event.clientX; pointerY = event.clientY; syncInteractive(); });
document.addEventListener('pointerleave', () => { pointerX = pointerY = -1; syncInteractive(); });
new MutationObserver(syncInteractive).observe(shell, { subtree: true, attributes: true, attributeFilter: ['open','hidden'] });
syncInteractive();
function stopSpeech() { if (api) void action({ type: 'cancelSpeech' }); }
function startWorkBgm(): void {
  void workBgm.play().catch(() => toast('工作音乐无法播放，请检查音乐文件是否存在或被系统静音。'));
}
function stopWorkBgm(): void {
  workBgm.pause();
  workBgm.currentTime = 0;
}
async function speak(text: string, preview = false) {
  if ((state?.paused && !preview) || !api) return;
  const plain = text.replace(/```[\s\S]*?```/g, '代码内容请查看文字。').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/[*#`_]/g, '').slice(0, 1600);
  if (!plain.trim()) return;
  await action({ type: 'speak', text: plain, preview });
}
function playDoubaoAudio(data: Uint8Array) {
  if (!data.length) return;
  doubaoPlaybackContext ??= new AudioContext({ sampleRate: 24000 });
  const context = doubaoPlaybackContext;
  const samples = new Int16Array(data.buffer, data.byteOffset, Math.floor(data.byteLength / 2));
  const buffer = context.createBuffer(1, samples.length, 24000);
  const channel = buffer.getChannelData(0);
  for (let i = 0; i < samples.length; i++) channel[i] = samples[i] / 32768;
  const source = context.createBufferSource(); source.buffer = buffer; source.connect(context.destination);
  const start = Math.max(context.currentTime, doubaoNextPlaybackTime);
  source.start(start); doubaoNextPlaybackTime = start + buffer.duration;
  void context.resume();
}
async function stopCodexVoice() {
  const peer = codexPeer;
  if (!peer && !codexStream && !codexAudio) return;
  codexPeer = undefined;
  codexStream?.getTracks().forEach(track => track.stop());
  codexStream = undefined;
  codexAudio?.pause();
  if (codexAudio) codexAudio.srcObject = null;
  codexAudio = undefined;
  peer?.close();
  if (api) await api.stopCodexVoice().catch(() => {});
}
async function startCodexVoice() {
  if (!api || state?.settings.voiceProvider !== 'codex' || state.paused || codexPeer || codexStarting) return;
  codexStarting = true;
  try {
    const local = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
    const peer = new RTCPeerConnection();
    codexPeer = peer; codexStream = local;
    const track = local.getAudioTracks()[0];
    if (!track) throw new Error('未找到麦克风音轨');
    peer.addTrack(track, local);
    peer.createDataChannel('oai-events');
    peer.ontrack = event => {
      const audio = codexAudio ?? new Audio();
      codexAudio = audio; audio.autoplay = true; audio.srcObject = event.streams[0] ?? new MediaStream([event.track]);
      void audio.play().catch(() => {});
    };
    peer.onconnectionstatechange = () => {
      if (peer.connectionState === 'failed') void action({ type: 'voiceError', message: 'Codex Voice WebRTC 连接失败，请检查 Codex 登录和网络。' });
    };
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    await waitForIceGathering(peer);
    const sdp = peer.localDescription?.sdp;
    if (!sdp) throw new Error('WebRTC 未生成 SDP offer');
    await api.startCodexVoice(sdp, 'cove');
  } catch (error) {
    await stopCodexVoice();
    await action({ type: 'voiceError', message: `无法启动 Codex Voice：${String(error)}` });
  } finally { codexStarting = false; }
}
function releaseMic() {
  micGeneration++;
  capture?.disconnect(); capture = undefined;
  stream?.getTracks().forEach(track => track.stop()); stream = undefined;
  void context?.close(); context = undefined;
}
async function startMic() {
  if (stream || micStarting || !api) return;
  micStarting = true; const generation = ++micGeneration;
  let localStream: MediaStream | undefined;
  let localContext: AudioContext | undefined;
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, sampleRate: 16000, echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
    if (generation !== micGeneration || state.paused) { localStream.getTracks().forEach(t => t.stop()); return; }
    localContext = new AudioContext({ sampleRate: 16000 });
    if (localContext.sampleRate !== 16000) throw new Error('音频设备不支持 16kHz 采集，请更换麦克风后重试');
    await localContext.audioWorklet.addModule(new URL('./voice-capture.js', document.baseURI).href);
    if (generation !== micGeneration || state.paused) { localStream.getTracks().forEach(t => t.stop()); await localContext.close(); return; }
    const source = localContext.createMediaStreamSource(localStream);
    const node = new AudioWorkletNode(localContext, 'jarvis-capture');
    const silence = localContext.createGain(); silence.gain.value = 0;
    source.connect(node); node.connect(silence); silence.connect(localContext.destination);
    node.port.onmessage = event => {
      const samples = event.data as Float32Array;
      let energy = 0; for (const s of samples) energy += s * s;
      level = Math.min(1, Math.sqrt(energy / samples.length) * 5);
      api.audio(samples);
    };
    localStream.getAudioTracks()[0].onended = () => { if (stream === localStream) void action({ type: 'voiceError', message: '麦克风已断开，请连接后点击恢复监听' }); };
    stream = localStream; context = localContext; capture = node;
    await localContext.resume();
  } catch (error) {
    localStream?.getTracks().forEach(t => t.stop()); void localContext?.close();
    if (generation === micGeneration) await action({ type: 'voiceError', message: `无法使用麦克风：${String(error)}。请检查 Windows 麦克风隐私设置，然后点击恢复监听。` });
  } finally { micStarting = false; if (!stream && state?.voiceReady && !state.paused && generation !== micGeneration) void startMic(); }
}
function showRequest(request: PendingRequest) {
  currentRequest = request;
  const key = `${typeof request.id}:${request.id}`;
  if (shownRequest === key) return;
  shownRequest = key;
  const questions = request.params.questions as any[] | undefined;
  $('#questions').replaceChildren();
  $('#request-title').textContent = questions ? '贾维斯想问你' : '需要你的确认';
  $('#request-note').textContent = questions ? '可以直接说出答案，或在这里填写。' : '请说“确认”或“取消”，也可以点击按钮。';
  $('#allow').textContent = questions ? '回答' : '允许一次';
  $('#request-details').hidden = !!questions;
  $('#request-details').textContent = JSON.stringify(request.params, null, 2).slice(0, 24000);
  if (questions) for (const question of questions) {
    const label = document.createElement('label'); label.textContent = question.question;
    const input = document.createElement('input'); input.name = question.id; input.required = true; input.autocomplete = 'off';
    label.append(input);
    if (question.options?.length) { const options = document.createElement('small'); options.textContent = question.options.map((o: any) => `${o.label}：${o.description}`).join('；'); label.append(options); }
    $('#questions').append(label);
  }
  if (settings.open) settings.close();
  if (!requestDialog.open) requestDialog.showModal();
  void speak(questions?.[0]?.question ?? `需要你的确认。${request.params.reason ?? ''}具体操作已显示在窗口。请说确认或取消。`);
}
function render(next: AssistantState) {
  const previousReply = state?.reply;
  const previousWeather = state?.weather;
  const started = next.busy && !wasBusy;
  const completed = wasBusy && !next.busy;
  if (started) {
    currentHudId = hudResults.begin();
    renderHudResults();
  }
  wasBusy = next.busy;
  state = next;
  if (next.status === 'paused' || next.status === 'degraded') { awaitingReply = false; lastSpoken = next.reply; }
  else if (next.busy) awaitingReply = true;
  const mode = next.status === 'paused' ? 'stopped' : next.status === 'approval' ? 'working' : next.status;
  shell.dataset.mode = mode;
  shell.dataset.status = next.status;
  $('#status').textContent = next.detail;
  $('#transcript').textContent = next.transcript || '—';
  $('#live-transcript-text').textContent = next.transcript || '等待语音…';
  $('#reply').textContent = next.reply || '说“嗨贾维斯”或“Hi Jarvis”，然后告诉我需要做什么。';
  if (currentHudId !== undefined && next.weather && weatherKey(next.weather) !== weatherKey(previousWeather)) updateCurrentWeather(next.weather);
  if (currentHudId !== undefined && (next.busy || completed || next.reply !== previousReply)) {
    updateCurrentHud(next.status === 'degraded' && next.reply === previousReply ? next.detail : next.reply, next.busy);
  }
  $('#mic').setAttribute('aria-label', next.paused ? '恢复监听' : '暂停监听');
  $('#mic').title = next.paused ? '恢复监听' : '暂停监听'; $('#mic').classList.toggle('is-paused', next.paused);
  const providerLabel = next.settings.voiceProvider === 'doubao' ? '豆包语音' : next.settings.voiceProvider === 'codex' ? 'Codex Voice' : '本地语音';
  $('#voice-note').textContent = next.voiceReady ? `${providerLabel}已就绪 · 唤醒词：嗨贾维斯 / Hi Jarvis` : `${providerLabel}未就绪 · 可以重新加载`;
  $('#thread-note').textContent = next.threadId ? `对话：${next.threadId}` : '发送第一条指令时连接 Codex';
  if (next.settings.voiceProvider === 'codex') {
    releaseMic();
    if (next.voiceReady && !next.paused) void startCodexVoice(); else if (next.paused || next.status === 'degraded') void stopCodexVoice();
  } else {
    void stopCodexVoice();
    if (next.voiceReady && !next.paused) void startMic(); else releaseMic();
  }
  if (next.status === 'degraded') { if (next.detail.length > 80) toast(next.detail); }
  if (next.requests.length) showRequest(next.requests[0]);
  else { shownRequest = ''; currentRequest = undefined; if (requestDialog.open) requestDialog.close(); }
  if (!next.busy && ['ready', 'listening'].includes(next.status) && next.reply && (awaitingReply || next.reply !== lastSpoken)) {
    awaitingReply = false; lastSpoken = next.reply; void speak(next.reply);
  }
}
$('#command').addEventListener('submit', event => {
  event.preventDefault();
  const input = $<HTMLInputElement>('#text');
  void submitCommandInput(input, text => action({ type: 'send', text }));
});
$('#mic').onclick = () => { stopSpeech(); void action({ type: 'pause', paused: !state.paused }); };
$('#stop').onclick = () => { stopSpeech(); void action({ type: 'stop' }); };
$('#exit').onclick = () => { stopSpeech(); releaseMic(); void action({ type: 'exit' }); };
$('#minimize').onclick = () => { void action({ type: 'minimize' }); };
$('#history').onclick = () => { $('#conversation').hidden = !$('#conversation').hidden; if (!$('#conversation').hidden) void loadArchive(); };
$('#close-history').onclick = () => $('#conversation').hidden = true;
let archiveView: 'history' | 'memories' = 'history';
let archiveQuery = '';
function setArchiveView(view: 'history' | 'memories') {
  archiveView = view;
  $('#archive-tab-history').setAttribute('aria-pressed', String(view === 'history'));
  $('#archive-tab-memories').setAttribute('aria-pressed', String(view === 'memories'));
  $<HTMLInputElement>('#archive-query').placeholder = view === 'history' ? '搜索本地聊天记录…' : '搜索长期记忆…';
  $('#archive-clear').textContent = view === 'history' ? '清空聊天记录' : '清空长期记忆';
  void loadArchive();
}
async function loadArchive() {
  const results = $('#archive-results');
  if (!api) { results.textContent = '桌面版本可查看本地记录'; return; }
  results.textContent = '正在加载';
  try {
    const values = archiveView === 'history'
      ? archiveQuery
        ? await api.archive({ type: 'searchHistory', query: archiveQuery, limit: 30 })
        : await api.archive({ type: 'listConversations', limit: 30 })
      : archiveQuery
        ? await api.archive({ type: 'searchMemories', query: archiveQuery, limit: 30 })
        : await api.archive({ type: 'listMemories', limit: 30 });
    const items = values as Array<Record<string, any>>;
    results.replaceChildren();
    if (!items.length) { results.textContent = archiveQuery ? '没有匹配记录' : '暂无记录'; return; }
    for (const item of items) {
      const row = document.createElement('article');
      const body = document.createElement('div');
      const title = document.createElement('strong');
      const detail = document.createElement('p');
      const meta = document.createElement('small');
      if (archiveView === 'history' && !archiveQuery) {
        title.textContent = String(item.preview ?? '对话');
        detail.textContent = `${item.turnCount ?? 0} 轮对话`;
        meta.textContent = `${new Date(Number(item.timestamp)).toLocaleString()} · ${item.workspace ?? ''}`;
      } else if (archiveView === 'history') {
        title.textContent = String(item.userText ?? '用户');
        detail.textContent = String(item.assistantText ?? '');
        meta.textContent = `${new Date(Number(item.timestamp)).toLocaleString()} · ${item.workspace ?? ''} · ${item.threadId ?? ''}`;
      } else {
        title.textContent = `记忆 #${item.id}`;
        detail.textContent = String(item.text ?? '');
        meta.textContent = `更新于 ${new Date(Number(item.updatedAt)).toLocaleString()}`;
      }
      body.append(title, detail, meta);
      const remove = document.createElement('button');
      remove.type = 'button'; remove.textContent = '删除'; remove.setAttribute('aria-label', `删除${archiveView === 'history' ? '对话' : '记忆'}`);
      remove.onclick = async () => {
        if (archiveView === 'history') await api.archive({ type: 'deleteConversation', threadId: String(item.threadId), workspace: String(item.workspace) });
        else await api.archive({ type: 'deleteMemory', id: Number(item.id) });
        await loadArchive();
      };
      row.append(body, remove); results.append(row);
    }
  } catch (error) { results.textContent = `本地记录读取失败：${String(error)}`; }
}
$('#archive-tab-history').onclick = () => setArchiveView('history');
$('#archive-tab-memories').onclick = () => setArchiveView('memories');
$('#archive-search').addEventListener('submit', event => { event.preventDefault(); archiveQuery = $<HTMLInputElement>('#archive-query').value.trim(); void loadArchive(); });
$('#archive-clear').onclick = async () => {
  const layer = archiveView === 'history' ? 'archive' : 'memories';
  const name = archiveView === 'history' ? 'Jarvis 本地聊天记录' : 'Jarvis 长期记忆';
  if (!window.confirm(`确定清空${name}吗？此操作不会删除 Codex 原生会话。`)) return;
  try { await api?.archive({ type: 'clear', layer }); await loadArchive(); }
  catch (error) { toast(`清空失败：${String(error)}`); }
};
const voiceProvider = $<HTMLSelectElement>('#voice-provider');
const doubaoSettings = [...document.querySelectorAll<HTMLElement>('.doubao-setting')];
function syncProviderFields() { doubaoSettings.forEach(field => { field.hidden = voiceProvider.value !== 'doubao'; }); }
voiceProvider.onchange = syncProviderFields;
$('#settings').onclick = () => { $<HTMLInputElement>('#cwd').value = state.settings.cwd; $<HTMLInputElement>('#codex-path').value = state.settings.codexPath; $<HTMLInputElement>('#mineradio-path').value = state.settings.mineradioPath ?? ''; voiceProvider.value = state.settings.voiceProvider; $<HTMLInputElement>('#doubao-api-key').value = state.settings.doubaoApiKey ?? ''; $<HTMLInputElement>('#doubao-asr-resource').value = state.settings.doubaoAsrResourceId ?? ''; $<HTMLInputElement>('#doubao-tts-resource').value = state.settings.doubaoTtsResourceId ?? ''; $<HTMLInputElement>('#doubao-voice-type').value = state.settings.doubaoVoiceType ?? ''; $<HTMLInputElement>('#amap-js-key').value = state.settings.amapJsApiKey ?? ''; $<HTMLInputElement>('#amap-security-code').value = state.settings.amapSecurityCode ?? ''; $<HTMLInputElement>('#qweather-api-host').value = state.settings.qweatherApiHost ?? ''; $<HTMLInputElement>('#qweather-api-key').value = state.settings.qweatherApiKey ?? ''; syncProviderFields(); settings.showModal(); };
$('#close-settings').onclick = () => settings.close();
$('#save-settings').onclick = async () => { await action({ type: 'settings', settings: { cwd: $<HTMLInputElement>('#cwd').value, codexPath: $<HTMLInputElement>('#codex-path').value, mineradioPath: $<HTMLInputElement>('#mineradio-path').value, voiceProvider: voiceProvider.value as 'codex' | 'doubao' | 'local', doubaoApiKey: $<HTMLInputElement>('#doubao-api-key').value, doubaoAsrResourceId: $<HTMLInputElement>('#doubao-asr-resource').value, doubaoTtsResourceId: $<HTMLInputElement>('#doubao-tts-resource').value, doubaoVoiceType: $<HTMLInputElement>('#doubao-voice-type').value, amapJsApiKey: $<HTMLInputElement>('#amap-js-key').value, amapSecurityCode: $<HTMLInputElement>('#amap-security-code').value, qweatherApiHost: $<HTMLInputElement>('#qweather-api-host').value, qweatherApiKey: $<HTMLInputElement>('#qweather-api-key').value } }); };
$('#retry-voice').onclick = () => { void action({ type: 'retryVoice' }); };
$('#new-thread').onclick = () => { stopSpeech(); void action({ type: 'newThread' }); };
$('#test-voice').onclick = () => { void speak('我在。你可以说，嗨贾维斯，打开浏览器搜索今天的天气。', true); };
$('#deny').onclick = () => { if (currentRequest) { stopSpeech(); void action({ type: 'respond', id: currentRequest.id, accept: false }); } };
$('#request-form').addEventListener('submit', event => {
  event.preventDefault(); if (!currentRequest) return;
  const answers: Record<string, { answers: string[] }> = {};
  for (const input of document.querySelectorAll<HTMLInputElement>('#questions input')) answers[input.name] = { answers: [input.value] };
  stopSpeech(); void action({ type: 'respond', id: currentRequest.id, accept: true, answers });
});
requestDialog.addEventListener('cancel', event => { event.preventDefault(); $('#deny').click(); });
window.addEventListener('beforeunload', () => { stopSpeech(); stopWorkBgm(); releaseMic(); void doubaoPlaybackContext?.close(); inspection?.exit(); stopGestureCamera(); helmetScene?.dispose(); for (const map of weatherMaps.values()) map.remove(); weatherMaps.clear(); });
if (api) { api.onState(render); api.onDoubaoAudio(playDoubaoAudio); api.onCodexVoiceEvent(event => {
  if (codexVoiceHud.accept(event) !== undefined) renderHudResults();
  const sdp = extractCodexSdpAnswer(event);
  if (sdp && codexPeer) void codexPeer.setRemoteDescription({ type: 'answer', sdp }).catch(error => void action({ type: 'voiceError', message: `Codex Voice SDP 连接失败：${String(error)}` }));
}); api.onSignal(signal => {
  if (signal === 'wake') { visuals.wake(); helmetScene?.wake(); }
  else if (signal === 'inspection-enter') void inspection?.enter().catch(() => {});
  else if (signal === 'inspection-exit') inspection?.exit();
  else if (signal === 'voice-reconnect') void stopCodexVoice().then(() => {
    if (state?.settings.voiceProvider === 'codex' && state.voiceReady && !state.paused) void startCodexVoice();
  });
  else if (signal === 'work-mode-start') startWorkBgm();
  else if (signal === 'work-mode-stop') stopWorkBgm();
}); void api.getState().then(render); }
else {
  document.documentElement.classList.add('visual-preview', 'transparency-grid');
  render({ status: 'ready', detail: '界面预览 · 桌面版本支持语音操作', transcript: '', reply: '', busy: false, paused: true, voiceReady: false, requests: [], settings: { cwd: '', codexPath: '', voiceProvider: 'local' } });
  visuals.wake(); helmetScene?.wake();
}
function animate() { visuals.update(shell.dataset.mode ?? 'ready', state?.status === 'speaking' ? .5 + Math.sin(performance.now() / 170) * .15 : level); level *= .9; requestAnimationFrame(animate); }
requestAnimationFrame(animate);
