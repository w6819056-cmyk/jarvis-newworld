import { app, BrowserWindow, ipcMain, globalShortcut, session, shell, screen } from 'electron';
import { existsSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';
import { spawn } from 'node:child_process';
import { CodexRuntime, resolveCodexExecutable, type Message } from './codex-runtime';
import { VoiceGate, isStopUtterance } from './voice-gate';
import { WindowsSpeech } from './windows-speech';
import { LocalTools, localToolSpecs } from './local-tools';
import { resolveInstalledApp } from './windows-apps';
import { validateAction, validateArchiveRequest, type AssistantState, type Action, type ArchiveRequest, type JarvisSignal, type Settings } from './protocol';
import { showWakeWindow } from './wake-window';
import { matchInspectionCommand } from './inspection-commands';
import { matchWorkModeCommand } from './work-mode';
import { DoubaoRuntime, DoubaoTtsRuntime, doubaoPlaybackDurationMs } from './doubao-runtime';
import { TranscriptEndpoint } from './transcript-endpoint';
import { stopTaskRuntime, type TaskStopReason } from './task-stop';
import { MineradioBridge } from './mineradio-bridge';
import { matchMineradioDirectCommand, matchMineradioVisualCommand, shouldOpenMineradioFromTranscript, type MineradioDirectCommand } from './mineradio-voice-command';
import { ConversationStore } from './conversation-store';
import { ConversationArchive } from './conversation-archive';
import { MemoryEmbedder, MEMORY_EMBEDDING_VERSION } from './memory-embeddings';
import { matchMemoryIntent } from './memory-intents';
import { extractCodexVoiceTranscript } from '../src/codex-voice';
import { lookupWeather } from './weather';
import { searchWeb } from './web-search';
import { HoloMapController } from '../modules/holo-map/controller';
import { ElectronHoloMapWindow } from './holo-map-window';
import { ElectronRainformWindow } from './rainform-window';
import { RainformController } from '../modules/rainform/control';
import { createQWeatherClient } from './qweather';
import { createRainSearchService, type RainCity } from './rain-search';
import { RainformOrchestrator } from './rainform-orchestration';
import { readSystemHealth } from './system-health';
import { createWindowsDesktopControl } from './desktop-control';
import { createDuplicateScanner } from './file-tools';
import { UiAutomationSession } from './ui-automation';
import { createPowerShellUiAutomationProbe } from './ui-automation-process';

// Keep Chromium's compositor and WebGL path available for the transparent
// full-monitor window. Electron still falls back safely when the driver does
// not support a requested acceleration feature.
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');

const MODEL = 'sherpa-onnx-x-asr-480ms-streaming-zipformer-transducer-zh-en-int8-2026-06-05';
let window: BrowserWindow;
let runtime: CodexRuntime | undefined;
const mineradio = new MineradioBridge();
let mineradioProcess: ReturnType<typeof spawn> | undefined;
let mineradioVoiceOpenPending = false;
let mineradioVisualPending = false;
let mineradioDirectPending = false;
let doubao: DoubaoRuntime | undefined;
let doubaoTts: DoubaoTtsRuntime | undefined;
let connecting: Promise<void> | undefined;
let worker: Worker | undefined;
let audioEpoch = 0;
let queuedFrames = 0;
let speaking = false;
let stopping = false;
let quitting = false;
let settingsPath: string;
let threads: Record<string, string> = {};
let state: AssistantState;
let conversationStore: ConversationStore | undefined;
let conversationArchive: ConversationArchive | undefined;
let memoryEmbedder: MemoryEmbedder | undefined;
let recentVoiceFinal: { key: string; at: number } | undefined;
const gate = new VoiceGate();
// Some streaming ASR responses contain useful partial text but omit the
// definite/endpoint marker. A short client-side silence endpoint prevents the
// wake flow from remaining in "我在听" forever in that case.
const transcriptEndpoint = new TranscriptEndpoint({ silenceMs: 700 });
const speech = new WindowsSpeech();
const holoMapWindow = new ElectronHoloMapWindow(() => ({ amapJsApiKey: state.settings.amapJsApiKey ?? '', amapSecurityCode: state.settings.amapSecurityCode ?? '' }));
const holoMap = new HoloMapController(holoMapWindow);
function getQWeatherClient() {
  const apiHost = state?.settings.qweatherApiHost?.trim();
  const apiKey = state?.settings.qweatherApiKey;
  if (!apiHost || !apiKey) throw new Error('请先在 Jarvis 设置中填写和风天气 API Host 与 API Key');
  return createQWeatherClient({ apiHost, apiKey });
}
const rainformWindow = new ElectronRainformWindow(getQWeatherClient);
const rainformController = new RainformController(rainformWindow);
const rainSearch = createRainSearchService({ readCurrent: city => getQWeatherClient().currentAt(city.latitude, city.longitude) });
let rainformOrchestrator: RainformOrchestrator | undefined;
function getRainformOrchestrator() {
  if (!rainformOrchestrator) {
    const catalogPath = path.join(app.getAppPath(), app.isPackaged ? 'dist-windows' : '', 'modules', 'rainform', 'city-catalog.json');
    const catalog = JSON.parse(readFileSync(catalogPath, 'utf8')) as { cities: RainCity[] };
    if (!Array.isArray(catalog.cities) || catalog.cities.length < 250) throw new Error('Rainform 城市目录不可用');
    rainformOrchestrator = new RainformOrchestrator({ map: holoMap, rainSearch, getWeather: getQWeatherClient, rainform: rainformController, cities: catalog.cities });
  }
  return rainformOrchestrator;
}
async function openMineradio() {
  if (mineradio.connected) return;
  const configured = state?.settings.mineradioPath?.trim();
  if (!configured || !path.isAbsolute(configured) || !existsSync(configured) || !statSync(configured).isFile()) {
    throw new Error('请在 Jarvis 设置中填写 Mineradio.exe 的完整路径');
  }
  if (!mineradioProcess || mineradioProcess.killed) {
    mineradioProcess = spawn(configured, mineradio.launchArgs, { windowsHide: true, stdio: 'ignore' });
    const child = mineradioProcess;
    const spawnError = new Promise<never>((_resolve, reject) => child.once('error', error => {
      if (mineradioProcess === child) mineradioProcess = undefined;
      publish({ detail: `Mineradio 启动失败：${error.message}` });
      reject(new Error(`Mineradio 启动失败：${error.message}`));
    }));
    child.once('exit', () => { if (mineradioProcess === child) mineradioProcess = undefined; });
    void spawnError.catch(() => {});
    const deadline = Date.now() + 12_000;
    while (!mineradio.connected && Date.now() < deadline) {
      await Promise.race([new Promise(resolve => setTimeout(resolve, 80)), spawnError]);
    }
    if (!mineradio.connected) throw new Error('Mineradio 启动超时，请确认路径指向可运行的 Mineradio.exe');
    return;
  }
  const deadline = Date.now() + 12_000;
  while (!mineradio.connected && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 80));
  if (!mineradio.connected) throw new Error('Mineradio 启动超时，请确认路径指向可运行的 Mineradio.exe');
}
const uiAutomationScript = app.isPackaged
  ? path.join(process.resourcesPath, 'app.asar.unpacked', 'dist-electron', 'windows-ui-automation.ps1')
  : path.join(__dirname, 'windows-ui-automation.ps1');
const localToolAdapter = { uiAutomation: process.platform === 'win32' ? new UiAutomationSession(createPowerShellUiAutomationProbe(uiAutomationScript)) : undefined, mineradio, map: holoMap, rainform: {
  findNearestRainyCity: () => getRainformOrchestrator().findNearestRainyCity(),
  showCityRain: (city: string) => getRainformOrchestrator().showCityRain(city),
}, openMineradio, desktop: createWindowsDesktopControl(), findDuplicates: (directories: string[]) => createDuplicateScanner().scan(directories), getSystemHealth: readSystemHealth, lookupWeather: (city?: string) => lookupWeather({ city }), searchWeb, openUrl: (url: string) => shell.openExternal(url), openApp: async (name: string) => {
  const target = resolveInstalledApp(name, file => shell.readShortcutLink(file));
  const error = await shell.openPath(target); if (error) throw new Error(error);
}, conversationStore: undefined as ConversationStore | undefined, memoryEmbedder: undefined as MemoryEmbedder | undefined };
const localTools = new LocalTools(localToolAdapter);
let speechSequence = 0;
let inspectionActive = false;
let workModeActive = false;
const answers = new Map<string | number, Record<string, { answers: string[] }>>();

function publish(update: Partial<AssistantState> = {}) {
  Object.assign(state, update);
  if (window && !window.isDestroyed()) window.webContents.send('jarvis:state', state);
}
let wakeOverlayTimer: ReturnType<typeof setTimeout> | undefined;
function signal(name: JarvisSignal) {
  if (!window || window.isDestroyed()) return;
  if (name === 'wake') {
    clearTimeout(wakeOverlayTimer);
    showWakeWindow(window);
    wakeOverlayTimer = setTimeout(() => { if (!window.isDestroyed()) window.setAlwaysOnTop(false); }, 4600);
  }
  window.webContents.send('jarvis:signal', name);
}
function resetAudio() { audioEpoch++; transcriptEndpoint.reset(); worker?.postMessage({ type: 'reset' }); }
function normalizeAudioSamples(value: unknown): Float32Array | undefined {
  if (value instanceof Float32Array) return value;
  if (value instanceof ArrayBuffer) return new Float32Array(value);
  if (Array.isArray(value) && value.length <= 8000 && value.every(sample => typeof sample === 'number' && Number.isFinite(sample))) {
    return Float32Array.from(value);
  }
  if (ArrayBuffer.isView(value)) {
    const view = value as ArrayBufferView;
    if (view.byteLength % Float32Array.BYTES_PER_ELEMENT !== 0) return undefined;
    return new Float32Array(view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength));
  }
  return undefined;
}
function cancelSpeech() {
  speechSequence++; speech.stop();
  if (!speaking) return;
  speaking = false; resetAudio();
  if (!state.busy || state.requests.length) gate.resume();
  if (!state.busy) idle();
}
async function speak(text: string, preview = false) {
  cancelSpeech();
  if ((state.paused && !preview) || !text.trim()) return;
  const token = ++speechSequence;
  speaking = true; gate.suspend(); resetAudio();
  publish({ status: state.requests.length ? 'approval' : 'speaking', detail: state.requests.length ? '等待你的答复' : '正在播报' });
  try {
    if (state.settings.voiceProvider === 'doubao') {
      if (!doubaoTts) throw new Error('豆包语音未连接，请检查 API Key 和资源标识后重新加载');
      const chunks = await doubaoTts.speak(text);
      if (!chunks.length) throw new Error('豆包 TTS 未返回音频，请检查 TTS 资源标识和音色');
      for (const chunk of chunks) if (window && !window.isDestroyed()) window.webContents.send('jarvis:doubao-audio', chunk);
      await new Promise(resolve => setTimeout(resolve, doubaoPlaybackDurationMs(chunks) + 150));
    } else await speech.speak(text);
  } catch (error) {
    if (token === speechSequence) fail(error);
  }
  finally {
    if (token === speechSequence) {
      speaking = false; resetAudio();
      if (!state.busy || state.requests.length) gate.resume();
      if (!state.busy) idle();
    }
  }
}
function idle() {
  if (state.paused) publish({ status: 'paused', detail: '监听已暂停' });
  else if (!state.voiceReady) publish({ status: 'degraded', detail: '语音未就绪，可先输入指令或在设置中重试' });
  else publish({ status: gate.awake ? 'listening' : 'ready', detail: gate.awake ? '我在听，请继续说' : '说“嗨贾维斯”或“Hi Jarvis”唤醒' });
}
function save() { writeFileSync(settingsPath, JSON.stringify({ settings: state.settings, threads, toolVersion: 1 }, null, 2), 'utf8'); }
function fail(error: unknown) {
  const detail = error instanceof Error ? error.message : String(error);
  publish({ status: 'degraded', detail, ...(state.busy ? { busy: false, reply: detail } : {}) });
}
function archiveUserText(text: string, threadId: string, source: 'typed' | 'voice'): number | undefined {
  if (!conversationStore || !text.trim() || !threadId.trim()) return undefined;
  const normalized = text.trim();
  const now = Date.now();
  if (source === 'voice') {
    const duplicateKey = `${threadId}|${normalized}`;
    if (recentVoiceFinal?.key === duplicateKey && now - recentVoiceFinal.at < 4000) return undefined;
    recentVoiceFinal = { key: duplicateKey, at: now };
  }
  const intent = matchMemoryIntent(normalized);
  if (intent?.type === 'remember') {
    void persistMemory(intent.text);
  }
  return conversationArchive?.beginUser({ text: normalized, threadId, workspace: state.settings.cwd, source, timestamp: now });
}
async function persistMemory(text: string): Promise<void> {
  if (!conversationStore) return;
  try {
    const record = conversationStore.putMemory(text, null);
    if (memoryEmbedder) {
      try {
        const embedding = await memoryEmbedder.embed(record.text);
        conversationStore.updateMemoryEmbedding(record.id, embedding, MEMORY_EMBEDDING_VERSION);
      } catch { /* Keyword search remains available if the local model cannot load. */ }
    }
    publish({ detail: memoryEmbedder ? '已保存到本地语义记忆' : '已保存到本地记忆（关键词搜索可用）' });
  } catch (error) { publish({ detail: `本地记忆保存失败：${error instanceof Error ? error.message : String(error)}` }); }
}
async function handleLocalMemoryIntent(text: string, source: 'typed' | 'voice'): Promise<boolean> {
  const intent = matchMemoryIntent(text);
  if (!intent || !conversationStore) return false;
  publish({ status: 'working', detail: '正在处理本地记忆', busy: true, transcript: text, reply: '', weather: undefined });
  const threadId = `jarvis-local:${state.settings.cwd}`;
  const turnId = conversationArchive?.beginUser({ text, threadId, workspace: state.settings.cwd, source, timestamp: Date.now() });
  const finish = async (reply: string) => {
    if (turnId) conversationStore?.completeTurn(turnId, reply, Date.now());
    publish({ status: 'ready', detail: '处理完成', busy: false, reply, transcript: text });
    await speak(reply.slice(0, 1000));
  };
  if (intent.type === 'remember') {
    await persistMemory(intent.text);
    await finish(`好的，已记住：${intent.text.slice(0, 180)}`);
    return true;
  }
  if (intent.type === 'list') {
    const memories = conversationStore.listMemories(20);
    const reply = memories.length ? memories.map((item, index) => `${index + 1}. ${item.text}`).join('；') : '目前没有保存的长期记忆。';
    await finish(reply);
    return true;
  }
  if (intent.type === 'forget') {
    const matches = conversationStore.searchMemories(intent.query, 5);
    if (matches.length === 1) {
      conversationStore.deleteMemory(matches[0].id);
      const reply = `好的，已忘记：${matches[0].text.slice(0, 160)}`;
      await finish(reply);
    } else {
      const reply = matches.length ? `找到 ${matches.length} 条相近记忆。请先打开长期记忆列表选择要删除的一条。` : '没有找到匹配的长期记忆。';
      await finish(reply);
    }
    return true;
  }
  const history = conversationStore.searchHistory(intent.query, 5);
  const reply = history.length
    ? history.map(item => `${new Date(item.timestamp).toLocaleDateString()}：你说${item.userText.slice(0, 120)}；我回复${item.assistantText.slice(0, 120)}`).join('。')
    : '没有找到相关的本地聊天记录。';
  await finish(reply);
  return true;
}
function archiveAssistantText(text: string): void {
  const threadId = state.threadId ?? threads[state.settings.cwd];
  if (!threadId || !text.trim()) return;
  try { conversationArchive?.completeAssistant(threadId, text.trim(), Date.now()); }
  catch (error) { publish({ detail: `本地聊天归档失败：${error instanceof Error ? error.message : String(error)}` }); }
}
function handleVoiceArchive(event: Message): boolean {
  const transcript = extractCodexVoiceTranscript(event);
  if (!transcript) return false;
  if (transcript.role === 'user') archiveUserText(transcript.text, transcript.threadId, 'voice');
  else {
    try { conversationArchive?.completeAssistant(transcript.threadId, transcript.text, Date.now()); }
    catch (error) { publish({ detail: `本地聊天归档失败：${error instanceof Error ? error.message : String(error)}` }); }
  }
  return true;
}
function handleArchiveRequest(request: ArchiveRequest): unknown {
  if (!conversationStore) throw new Error('本地聊天档案尚未就绪');
  switch (request.type) {
    case 'listConversations': return conversationStore.listConversations(request.limit);
    case 'searchHistory': return conversationStore.searchHistory(request.query, request.limit);
    case 'searchMemories': {
      const candidates = memoryEmbedder ? conversationStore.listMemories(100) : conversationStore.searchMemories(request.query, request.limit);
      if (!memoryEmbedder) return candidates;
      return memoryEmbedder.search(request.query, candidates, request.limit).catch(() => conversationStore?.searchMemories(request.query, request.limit) ?? []);
    }
    case 'listMemories': return conversationStore.listMemories(request.limit).map(({ id, text, createdAt, updatedAt }) => ({ id, text, createdAt, updatedAt }));
    case 'deleteConversation': return conversationStore.deleteConversation(request.threadId, request.workspace);
    case 'deleteMemory': return conversationStore.deleteMemory(request.id);
    case 'clear': if (request.layer === 'archive') conversationStore.clearArchive(); else conversationStore.clearMemories(); return true;
  }
}
function finishInspection(text: string) {
  inspectionActive = false;
  gate.reset();
  signal('inspection-exit');
  publish({ transcript: text, detail: '战甲检查已结束' });
}
async function enterWorkMode(text: string) {
  workModeActive = true;
  publish({ status: 'working', busy: true, reply: '', transcript: text, detail: '正在进入工作模式', weather: undefined });
  await speak('好的，现在进入工作模式');
  if (workModeActive && !stopping && !quitting) {
    signal('work-mode-start');
    publish({ status: 'ready', busy: false, reply: '好的，现在进入工作模式。背景音乐已开始播放。', detail: '工作模式已开启' });
  }
}
function exitWorkMode(text: string) {
  workModeActive = false;
  signal('work-mode-stop');
  publish({ status: 'working', busy: true, reply: '', transcript: text, detail: '正在结束工作模式', weather: undefined });
  publish({ status: 'ready', busy: false, reply: '工作模式已结束，背景音乐已停止。', detail: '工作模式已结束' });
}

function handleCodex(event: Message, owner: CodexRuntime) {
  if (owner !== runtime || stopping || quitting) return;
  const p = event.params;
  if (event.method?.startsWith('thread/realtime/')) {
    handleVoiceArchive(event);
    if (window && !window.isDestroyed()) window.webContents.send('jarvis:codex-voice-event', event);
    if (event.method === 'thread/realtime/error') fail(new Error(p?.message ?? 'Codex Voice 实时会话出错'));
    return;
  }
  if (event.method && event.id !== undefined) {
    if (event.method === 'item/tool/call') {
      const id = event.id;
      void localTools.call(p?.tool, p?.arguments).then(result => {
        if (owner === runtime && !stopping && !quitting) {
          if (result.display?.kind === 'weather') publish({ weather: result.display.weather });
          owner.respondTool(id, result);
        }
      }).catch(fail);
      return;
    }
    if (!['item/commandExecution/requestApproval', 'item/fileChange/requestApproval', 'item/permissions/requestApproval', 'item/tool/requestUserInput', 'execCommandApproval', 'applyPatchApproval'].includes(event.method)) {
      owner.respond(event.id, false); return;
    }
    if (!state.requests.some(r => r.id === event.id)) {
      publish({ status: 'approval', detail: '等待你的答复', requests: [...state.requests, { id: event.id, method: event.method, params: p ?? {} }] });
      // Replies to real server approval requests remain possible while the turn waits.
      gate.resume(); resetAudio();
    }
    return;
  }
  switch (event.method) {
    case 'item/agentMessage/delta': publish({ reply: (state.reply + (p?.delta ?? '')).slice(-30000) }); break;
    case 'item/completed':
      if (p?.item?.type === 'agentMessage' && p.item.text) { publish({ reply: p.item.text }); archiveAssistantText(p.item.text); }
      break;
    case 'turn/completed': {
      const failed = p?.turn?.status === 'failed';
      if (failed) conversationArchive?.failPending(state.threadId ?? threads[state.settings.cwd] ?? '');
      publish({ busy: false, requests: [] }); answers.clear();
      gate.resume(); resetAudio();
      if (failed) fail(new Error(p?.turn?.error?.message ?? 'Codex 执行失败，请检查登录和网络后重试'));
      else idle();
      break;
    }
    case 'error': if (p?.willRetry === false) fail(new Error(p?.error?.message ?? 'Codex 执行出错')); break;
    case 'jarvis/disconnected':
      runtime = undefined; connecting = undefined;
      publish({ busy: false, requests: [] }); gate.resume(); resetAudio();
      fail(new Error(p?.message ?? 'Codex 已断开，下次发送会重新连接')); break;
  }
}

async function connect() {
  if (runtime && !connecting) return;
  if (connecting) return connecting;
  const owner = new CodexRuntime({ executablePath: resolveCodexExecutable({ configuredPath: state.settings.codexPath || undefined }), dynamicTools: localToolSpecs });
  runtime = owner;
  owner.onEvent(event => handleCodex(event, owner));
  connecting = (async () => {
    const result = await owner.start({ cwd: state.settings.cwd, threadId: threads[state.settings.cwd] });
    if (runtime !== owner || stopping) throw new Error('连接已取消');
    threads[state.settings.cwd] = result.threadId; save();
    publish({ threadId: result.threadId });
  })();
  try { await connecting; }
  catch (error) { if (runtime === owner) runtime = undefined; await owner.shutdown(); throw error; }
  finally { connecting = undefined; }
}
async function submit(text: string, source: 'typed' | 'voice' = 'typed') {
  if (stopping) throw new Error('正在停止，请稍候');
  if (state.busy) throw new Error('当前任务尚未结束，可先点击停止');
  if (await handleLocalMemoryIntent(text, source)) return;
  cancelSpeech(); signal('cancelSpeech'); gate.suspend(); resetAudio();
  publish({ status: 'working', detail: '正在处理', busy: true, transcript: text, reply: '', weather: undefined });
  try { await connect(); if (!stopping && runtime) { archiveUserText(text, threads[state.settings.cwd] ?? state.threadId ?? '', source); await runtime.sendText(text); } }
  catch (error) {
    conversationArchive?.failPending(threads[state.settings.cwd] ?? state.threadId ?? '');
    const detail = error instanceof Error ? error.message : String(error);
    publish({ busy: false, reply: detail }); gate.resume(); fail(error);
  }
}
function answerRequest(id: string | number, accept: boolean, input?: Record<string, { answers: string[] }>) {
  if (!runtime || !state.requests.some(r => r.id === id)) throw new Error('这个请求已结束');
  cancelSpeech(); runtime.respond(id, accept, input);
  answers.delete(id);
  const remaining = state.requests.filter(r => r.id !== id);
  publish({ requests: remaining, status: remaining.length ? 'approval' : 'working', detail: remaining.length ? '等待你的答复' : '继续处理' });
  if (!remaining.length) gate.suspend();
  resetAudio();
}
async function applyMineradioVisualCommand(command: { presetId: number } | { random: true }, transcriptText: string) {
  if (mineradioVisualPending) return;
  mineradioVisualPending = true;
  publish({ status: 'working', busy: true, reply: '', transcript: transcriptText, detail: '正在切换音乐视觉效果', weather: undefined });
  try {
    await openMineradio();
    const result = await mineradio.request('visual.set_preset', command);
    if (!result.success) throw new Error(result.error?.message ?? 'Mineradio 未能切换视觉预设');
    const name = typeof result.result?.presetName === 'string' ? result.result.presetName : '新预设';
    publish({ status: 'ready', busy: false, reply: `音乐视觉效果已切换为${name}`, detail: `音乐视觉效果已切换为${name}` });
  } catch (error) {
    const message = `音乐视觉效果切换失败：${error instanceof Error ? error.message : String(error)}`;
    publish({ status: 'degraded', busy: false, reply: message, detail: message });
  } finally {
    mineradioVisualPending = false;
  }
}
async function applyMineradioDirectCommand(command: MineradioDirectCommand, transcriptText: string) {
  if (mineradioDirectPending) return;
  mineradioDirectPending = true;
  publish({ status: 'working', busy: true, reply: '', transcript: transcriptText, detail: '正在执行音乐控制', weather: undefined });
  try {
    await openMineradio();
    const result = await mineradio.request(command.action, command.payload);
    if (!result.success) throw new Error(result.error?.message ?? 'Mineradio 未能执行音乐控制');
    const detail = command.action === 'player.pause' ? '音乐已暂停'
      : command.action === 'player.resume' ? '音乐已继续'
      : command.action === 'player.next' ? '已切换到下一首'
      : command.action === 'player.previous' ? '已回到上一首'
      : command.action === 'player.set_volume' ? `音量已设置为 ${String(command.payload.volume)}%`
      : '已读取当前播放状态';
    publish({ status: 'ready', busy: false, reply: detail, detail });
  } catch (error) {
    const message = `音乐控制失败：${error instanceof Error ? error.message : String(error)}`;
    publish({ status: 'degraded', busy: false, reply: message, detail: message });
  } finally {
    mineradioDirectPending = false;
  }
}
function transcript(text: string, final: boolean) {
  if (stopping || state.paused) return;
  const normalized = text.trim();
  if (!normalized) return;
  if (final) transcriptEndpoint.accept(normalized, true);
  if (!speaking) publish({ transcript: normalized });
  if (final && !speaking && !state.busy && !state.requests.length && shouldOpenMineradioFromTranscript(normalized, final)) {
    if (!mineradioVoiceOpenPending) {
      mineradioVoiceOpenPending = true;
      publish({ detail: '正在打开音乐播放器' });
      void (async () => {
        try {
          await openMineradio();
          const result = await mineradio.request('app.focus');
          if (!result.success) throw new Error(result.error?.message ?? '播放器未能切换到前台');
          publish({ detail: '音乐播放器已打开' });
        } catch (error) {
          publish({ detail: `音乐播放器打开失败：${error instanceof Error ? error.message : String(error)}` });
        } finally {
          mineradioVoiceOpenPending = false;
        }
      })();
    }
    return;
  }
  if (final && !speaking && inspectionActive && matchInspectionCommand(text, true) === 'exit') {
    finishInspection(text);
    return;
  }
  // This exact phrase is also a self-contained wake command, so it works
  // without requiring a separate "嗨贾维斯" utterance first.
  if (final && !speaking) {
    const directWorkCommand = matchWorkModeCommand(text, workModeActive);
    if (directWorkCommand === 'enter') { void enterWorkMode(text).catch(fail); return; }
    if (directWorkCommand === 'exit') { exitWorkMode(text); return; }
  }
  if (final && isStopUtterance(text) && (speaking || state.busy)) { void stop(); return; }
  if (speaking || (state.busy && !state.requests.length)) { transcriptEndpoint.reset(); return; }
  if (!final) { transcriptEndpoint.accept(normalized, false); return; }
  const result = gate.accept(text, final);
  if (result.wake) { signal('wake'); publish({ status: state.requests.length ? 'approval' : 'listening', detail: '我在听' }); }
  if (result.acknowledge && !state.requests.length) { void speak('我在，请说。').catch(fail); return; }
  if (!result.text) return;
  publish({ transcript: result.text });
  if (matchInspectionCommand(result.text, inspectionActive) === 'exit') {
    finishInspection(result.text);
    return;
  }
  if (state.requests.length) {
    const request = state.requests[0];
    if (request.method === 'item/tool/requestUserInput') {
      const given = answers.get(request.id) ?? {};
      const next = request.params.questions?.find((q: any) => !Object.hasOwn(given, q.id));
      if (next) {
        given[next.id] = { answers: [result.text] }; answers.set(request.id, given);
        const question = request.params.questions.find((q: any) => !Object.hasOwn(given, q.id));
        if (question) publish({ detail: question.question });
        else answerRequest(request.id, true, given);
      }
    } else if (/^(确认|同意|允许|可以|是的|执行|确认执行)[。！!\s]*$/.test(result.text)) answerRequest(request.id, true);
    else if (/^(取消|拒绝|不允许|不要|不|停止)[。！!\s]*$/.test(result.text)) answerRequest(request.id, false);
    else publish({ detail: '请说“确认”或“取消”，也可以点击窗口中的按钮' });
    return;
  }
  const visualCommand = matchMineradioVisualCommand(result.text);
  if (visualCommand) { void applyMineradioVisualCommand(visualCommand, result.text); return; }
  const directCommand = matchMineradioDirectCommand(result.text);
  if (directCommand) { void applyMineradioDirectCommand(directCommand, result.text); return; }
  if (/^(停止|停下|取消任务)[。！!\s]*$/.test(result.text)) { void stop(); return; }
  if (/^(结束对话|休息吧|再见)[。！!\s]*$/.test(result.text)) { gate.reset(); idle(); return; }
  if (matchInspectionCommand(result.text, inspectionActive) === 'enter') {
    inspectionActive = true;
    signal('inspection-enter');
    publish({ detail: '正在进行战甲检查' });
    return;
  }
  void submit(result.text, 'voice');
}

async function startVoice() {
  if (state.settings.voiceProvider === 'doubao') {
    if (worker) { await worker.terminate(); worker = undefined; }
    if (doubao) await doubao.stop();
    let owner!: DoubaoRuntime;
    owner = new DoubaoRuntime({ apiKey: state.settings.doubaoApiKey ?? '', resourceId: state.settings.doubaoAsrResourceId ?? '', onError: error => {
      if (doubao === owner) { doubao = undefined; fail(error); }
    } });
    doubaoTts = new DoubaoTtsRuntime({ apiKey: state.settings.doubaoApiKey ?? '', resourceId: state.settings.doubaoTtsResourceId || 'seed-tts-2.0', voiceType: state.settings.doubaoVoiceType || 'zh_female_vv_uranus_bigtts' });
    owner.onTranscript(result => transcript(result.text, result.final));
    try {
      await owner.start();
    } catch (error) {
      await owner.stop().catch(() => {});
      doubaoTts = undefined;
      throw error;
    }
    doubao = owner;
    publish({ voiceReady: true, detail: '豆包实时语音已连接' });
    idle();
    return;
  }
  if (state.settings.voiceProvider !== 'local') {
    if (worker) { await worker.terminate(); worker = undefined; }
    publish({ voiceReady: state.settings.voiceProvider === 'codex', detail: state.settings.voiceProvider === 'codex' ? 'Codex Voice 已准备，正在等待 WebRTC' : '豆包语音配置已保存，实时服务尚未接入' });
    idle();
    return;
  }
  if (worker) await worker.terminate();
  const modelPath = path.join(app.isPackaged ? process.resourcesPath : app.getAppPath(), 'runtime', 'models', MODEL);
  for (const name of ['encoder.int8.onnx', 'decoder.onnx', 'joiner.int8.onnx', 'tokens.txt']) {
    if (!existsSync(path.join(modelPath, name))) throw new Error('缺少本地语音模型，请运行模型下载步骤后重试');
  }
  publish({ voiceReady: false, detail: '正在加载本地语音模型' });
  const owner = new Worker(path.join(__dirname, 'asr-worker.cjs'), { workerData: { modelPath } });
  worker = owner; queuedFrames = 0;
  owner.on('message', message => {
    if (worker !== owner || quitting) return;
    if (message.type === 'ready') { publish({ voiceReady: true }); idle(); }
    if (message.type === 'result' && message.epoch === audioEpoch) transcript(message.text, message.final);
    if (message.type === 'ack') queuedFrames = Math.max(0, queuedFrames - 1);
    if (message.type === 'error') { publish({ voiceReady: false }); fail(new Error(message.message)); void owner.terminate(); }
  });
  owner.on('error', error => { if (worker === owner) { publish({ voiceReady: false }); fail(error); } });
  owner.on('exit', code => { if (worker === owner && !quitting) { worker = undefined; publish({ voiceReady: false }); if (code) fail(new Error('语音引擎已停止，可在设置中重新加载')); } });
}
async function stop(reason: TaskStopReason = 'task') {
  if (stopping) return;
  stopping = true; workModeActive = false; cancelSpeech(); signal('cancelSpeech'); signal('work-mode-stop'); gate.reset(); resetAudio();
  publish({ busy: false, requests: [], status: 'paused', detail: '正在停止任务' }); answers.clear();
  const owner = runtime; runtime = undefined;
  try {
    if (reason === 'settings' || reason === 'quit') {
      if (doubao) { await doubao.stop(); doubao = undefined; }
      doubaoTts = undefined;
    }
    const runtimeClosed = await stopTaskRuntime(owner, reason);
    if (!runtimeClosed) runtime = owner;
    if (reason !== 'task' || runtimeClosed) connecting = undefined;
  } finally {
    stopping = false;
    idle();
    if (reason === 'task' && !runtime) signal('voice-reconnect');
  }
}

async function action(a: Action) {
  switch (a.type) {
    case 'send': return submit(a.text);
    case 'stop': return stop();
    case 'exit': app.quit(); return;
    case 'minimize': window.minimize(); return;
    case 'listen': if (!state.voiceReady) throw new Error('语音未就绪，请在设置中重新加载'); publish({ paused: false }); gate.resume(); resetAudio(); idle(); return;
    case 'pause':
      publish({ paused: a.paused }); cancelSpeech(); signal('cancelSpeech'); gate.reset(); resetAudio();
      if (!state.busy) idle(); return;
    case 'retryVoice': return startVoice();
    case 'speak': return speak(a.text, a.preview);
    case 'cancelSpeech': cancelSpeech(); return;
    case 'voiceError': publish({ paused: true }); fail(new Error(a.message)); return;
    case 'respond': answerRequest(a.id, a.accept, a.answers); return;
    case 'newThread': await stop('new-thread'); delete threads[state.settings.cwd]; save(); publish({ threadId: undefined, reply: '', transcript: '' }); signal('voice-reconnect'); return;
    case 'settings': {
      const { cwd, codexPath, mineradioPath, voiceProvider, doubaoApiKey, doubaoAsrResourceId, doubaoTtsResourceId, doubaoVoiceType, amapJsApiKey, amapSecurityCode, qweatherApiHost, qweatherApiKey } = a.settings;
      if (!path.isAbsolute(cwd) || !existsSync(cwd) || !statSync(cwd).isDirectory()) throw new Error('工作目录必须是已存在的完整文件夹路径');
      if (codexPath && (!path.isAbsolute(codexPath) || !existsSync(codexPath) || !statSync(codexPath).isFile())) throw new Error('请填写 codex.exe 的完整路径，或留空自动查找');
      if (mineradioPath && (!path.isAbsolute(mineradioPath) || !existsSync(mineradioPath) || !statSync(mineradioPath).isFile())) throw new Error('请填写 Mineradio.exe 的完整路径，或留空');
      await stop('settings'); publish({ settings: { cwd: path.resolve(cwd), codexPath, mineradioPath, voiceProvider, doubaoApiKey, doubaoAsrResourceId, doubaoTtsResourceId, doubaoVoiceType, amapJsApiKey, amapSecurityCode, qweatherApiHost, qweatherApiKey }, threadId: threads[path.resolve(cwd)], voiceReady: false }); save();
      try { await startVoice(); } catch (error) { fail(error); }
      return;
    }
  }
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); } });
  void app.whenReady().then(async () => {
    settingsPath = path.join(app.getPath('userData'), 'jarvis-settings.json');
    conversationStore = new ConversationStore(path.join(app.getPath('userData'), 'conversation-memory.sqlite'));
    conversationArchive = new ConversationArchive(conversationStore);
    localToolAdapter.conversationStore = conversationStore;
    const modelPath = path.join(app.isPackaged ? process.resourcesPath : app.getAppPath(), 'models', 'jarvis-memory');
    const devModelPath = path.join(app.getAppPath(), 'runtime', 'models', 'jarvis-memory');
    const resolvedModelPath = app.isPackaged ? modelPath : existsSync(path.join(devModelPath, 'onnx', 'model_quantized.onnx')) ? devModelPath : modelPath;
    if (existsSync(path.join(resolvedModelPath, 'onnx', 'model_quantized.onnx'))) {
      memoryEmbedder = new MemoryEmbedder(resolvedModelPath, {
        onReembedded: record => conversationStore?.updateMemoryEmbedding(record.id, record.embedding!, MEMORY_EMBEDDING_VERSION),
      });
      localToolAdapter.memoryEmbedder = memoryEmbedder;
    }
    let settings: Settings = { cwd: app.getPath('documents'), codexPath: '', mineradioPath: '', voiceProvider: 'local' };
    let importedRainformWeatherConfig = false;
    try {
      const saved = JSON.parse(readFileSync(settingsPath, 'utf8'));
      if (typeof saved.settings?.cwd === 'string' && existsSync(saved.settings.cwd)) settings.cwd = saved.settings.cwd;
      if (typeof saved.settings?.codexPath === 'string') settings.codexPath = saved.settings.codexPath;
      if (typeof saved.settings?.mineradioPath === 'string') settings.mineradioPath = saved.settings.mineradioPath;
      if (saved.settings?.voiceProvider === 'codex' || saved.settings?.voiceProvider === 'doubao' || saved.settings?.voiceProvider === 'local') settings.voiceProvider = saved.settings.voiceProvider;
      for (const key of ['doubaoApiKey', 'doubaoAsrResourceId', 'doubaoTtsResourceId', 'doubaoVoiceType'] as const) {
        if (typeof saved.settings?.[key] === 'string') settings[key] = saved.settings[key];
      }
      for (const key of ['amapJsApiKey', 'amapSecurityCode'] as const) {
        if (typeof saved.settings?.[key] === 'string' && saved.settings[key].length <= 512) settings[key] = saved.settings[key];
      }
      if (typeof saved.settings?.qweatherApiHost === 'string' && /^(?:[a-z0-9-]+\.)+qweatherapi\.com$/i.test(saved.settings.qweatherApiHost)) settings.qweatherApiHost = saved.settings.qweatherApiHost;
      if (typeof saved.settings?.qweatherApiKey === 'string' && saved.settings.qweatherApiKey.length <= 512) settings.qweatherApiKey = saved.settings.qweatherApiKey;
      if (saved.toolVersion === 1 && saved.threads && typeof saved.threads === 'object') threads = saved.threads;
    } catch { /* first launch */ }
    if (!settings.qweatherApiHost || !settings.qweatherApiKey) {
      try {
        const envPath = path.join(app.getPath('home'), 'Rainform', '.env');
        const values: Record<string, string> = {};
        for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
          const match = line.match(/^\s*(QWEATHER_API_HOST|QWEATHER_API_KEY)\s*=\s*(.*?)\s*$/);
          if (match) values[match[1]!] = match[2]!.replace(/^(['"])(.*)\1$/, '$2');
        }
        if (!settings.qweatherApiHost && values.QWEATHER_API_HOST && /^(?:[a-z0-9-]+\.)+qweatherapi\.com$/i.test(values.QWEATHER_API_HOST)) {
          settings.qweatherApiHost = values.QWEATHER_API_HOST.toLowerCase(); importedRainformWeatherConfig = true;
        }
        if (!settings.qweatherApiKey && values.QWEATHER_API_KEY && values.QWEATHER_API_KEY.length <= 512) {
          settings.qweatherApiKey = values.QWEATHER_API_KEY; importedRainformWeatherConfig = true;
        }
      } catch { /* Rainform credentials are optional and never logged */ }
    }
    state = { status: 'booting', detail: '正在启动', transcript: '', reply: '', busy: false, paused: false, voiceReady: false, requests: [], settings };
    if (importedRainformWeatherConfig) save();
    mineradio.onEvent((event, payload) => {
      if (event === 'connection') publish({ detail: payload.connected ? 'Mineradio 已连接' : 'Mineradio 已断开' });
    });
    await mineradio.start();
    const page = pathToFileURL(path.join(app.getAppPath(), 'dist-windows', 'windows.html')).href;
    let display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    // Full-monitor animation surface; only the compact assistant accepts clicks.
    window = new BrowserWindow({ ...display.bounds, useContentSize: true, transparent: true, backgroundColor: '#00000000', frame: false, hasShadow: false, resizable: false, title: 'Jarvis', show: false,
      webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false } });
    window.setIgnoreMouseEvents(true, { forward: true });
    const fitDisplay = () => {
      display = screen.getAllDisplays().find(d => d.id === display.id) ?? screen.getPrimaryDisplay();
      if (!window.isDestroyed()) window.setBounds(display.bounds);
    };
    screen.on('display-metrics-changed', fitDisplay);
    screen.on('display-removed', fitDisplay);
    const trusted = (event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent) => event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame;
    ipcMain.handle('jarvis:state', event => { if (!trusted(event)) throw new Error('无效窗口'); return state; });
    ipcMain.handle('jarvis:action', async (event, value) => { if (!trusted(event)) throw new Error('无效窗口'); await action(validateAction(value)); });
    ipcMain.handle('jarvis:archive', async (event, value) => { if (!trusted(event)) throw new Error('无效窗口'); return handleArchiveRequest(validateArchiveRequest(value)); });
    ipcMain.handle('jarvis:codex-voice-start', async (event, value) => {
      if (!trusted(event) || state.settings.voiceProvider !== 'codex') throw new Error('当前未选择 Codex Voice');
      if (typeof value?.sdp !== 'string' || !value.sdp.startsWith('v=0')) throw new Error('WebRTC SDP offer 无效');
      await connect();
      if (!runtime) throw new Error('Codex 尚未连接');
      await runtime.startRealtime({ sdp: value.sdp, voice: typeof value.voice === 'string' ? value.voice : undefined });
    });
    ipcMain.handle('jarvis:codex-voice-stop', async event => {
      if (!trusted(event)) throw new Error('无效窗口');
      await runtime?.stopRealtime();
    });
    ipcMain.handle('jarvis:codex-voice-text', async (event, value) => {
      if (!trusted(event) || typeof value !== 'string') throw new Error('无效 Voice 文本');
      await runtime?.appendRealtimeText(value);
    });
    ipcMain.on('jarvis:interactive', (event, value) => {
      if (trusted(event) && typeof value === 'boolean') window.setIgnoreMouseEvents(!value, { forward: true });
    });
    ipcMain.on('jarvis:audio', (event, samples) => {
      if (!trusted(event) || state.settings.voiceProvider === 'codex' || !state.voiceReady || state.paused || stopping) return;
      const normalized = normalizeAudioSamples(samples);
      if (!normalized || normalized.length > 8000) return;
      let energy = 0;
      for (const sample of normalized) energy += sample * sample;
      const hasVoice = Math.sqrt(energy / normalized.length) >= 0.015;
      const forcedFinal = transcriptEndpoint.onAudio(hasVoice);
      if (forcedFinal && !speaking && !stopping && !state.paused) transcript(forcedFinal, true);
      if (queuedFrames >= 8) return;
      if (state.settings.voiceProvider === 'doubao') { doubao?.sendAudio(normalized); return; }
      if (!worker) return;
      queuedFrames++; worker.postMessage({ type: 'audio', samples: normalized, epoch: audioEpoch });
    });
    session.defaultSession.setPermissionRequestHandler((contents, permission, callback) => callback(contents === window.webContents && permission === 'media'));
    session.defaultSession.setPermissionCheckHandler((contents, permission) => contents === window.webContents && permission === 'media');
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event, url) => { if (url !== page) event.preventDefault(); });
    window.on('ready-to-show', () => {
      window.show();
      // Windows may clamp initial dimensions to the work area during creation.
      // Apply monitor bounds after showing so the particle canvas includes taskbar edges.
      fitDisplay();
    });
    window.on('closed', () => app.quit());
    globalShortcut.register('CommandOrControl+Shift+Space', () => { void stop(); });
    await window.loadURL(page);
    await startVoice().catch(fail);
    setInterval(() => { if (state.status === 'listening' && !gate.awake && !state.busy && !speaking) idle(); }, 1000).unref();
  }).catch(error => { console.error(error); app.quit(); });
}
app.on('window-all-closed', () => app.quit());
app.on('before-quit', event => {
  if (quitting || !state) return;
  event.preventDefault(); quitting = true; globalShortcut.unregisterAll();
  void Promise.allSettled([stop('quit'), worker?.terminate(), mineradio.close()]).finally(() => {
    holoMap.dispose();
    holoMapWindow.close();
    rainformController.dispose();
    rainformWindow.close();
    conversationStore?.close();
    app.quit();
  });
});
