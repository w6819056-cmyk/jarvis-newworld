export type Status = 'booting' | 'ready' | 'listening' | 'working' | 'speaking' | 'approval' | 'paused' | 'degraded';
export type VoiceProvider = 'codex' | 'doubao' | 'local';
export type Settings = {
  cwd: string;
  codexPath: string;
  mineradioPath?: string;
  voiceProvider: VoiceProvider;
  doubaoApiKey?: string;
  doubaoAsrResourceId?: string;
  doubaoTtsResourceId?: string;
  doubaoVoiceType?: string;
  amapJsApiKey?: string;
  amapSecurityCode?: string;
  qweatherApiHost?: string;
  qweatherApiKey?: string;
};
export type PendingRequest = { id: string | number; method: string; params: Record<string, any> };
export type JarvisSignal = 'wake' | 'cancelSpeech' | 'voice-reconnect' | 'inspection-enter' | 'inspection-exit' | 'work-mode-start' | 'work-mode-stop';
export type WeatherDisplay = {
  city: string; country?: string; latitude: number; longitude: number;
  temperature: number; feelsLike?: number; humidity?: number; windSpeed?: number;
  weatherCode: number; condition: string; updatedAt?: string; locationMode: 'current' | 'named';
};
export type AssistantState = {
  status: Status; detail: string; transcript: string; reply: string;
  busy: boolean; paused: boolean; voiceReady: boolean; threadId?: string;
  requests: PendingRequest[]; settings: Settings; weather?: WeatherDisplay;
};
export type Action =
  | { type: 'send'; text: string }
  | { type: 'pause'; paused: boolean }
  | { type: 'stop' | 'exit' | 'minimize' | 'listen' | 'retryVoice' | 'newThread' | 'cancelSpeech' }
  | { type: 'settings'; settings: Settings }
  | { type: 'respond'; id: string | number; accept: boolean; answers?: Record<string, { answers: string[] }> }
  | { type: 'speak'; text: string; preview?: boolean }
  | { type: 'voiceError'; message: string };
export type ArchiveRequest =
  | { type: 'listConversations'; limit: number }
  | { type: 'searchHistory'; query: string; limit: number }
  | { type: 'searchMemories'; query: string; limit: number }
  | { type: 'listMemories'; limit: number }
  | { type: 'deleteConversation'; threadId: string; workspace: string }
  | { type: 'deleteMemory'; id: number }
  | { type: 'clear'; layer: 'archive' | 'memories' };
export type Bridge = {
  getState(): Promise<AssistantState>;
  action(action: Action): Promise<void>;
  audio(samples: Float32Array): void;
  setInteractive(value: boolean): void;
  startCodexVoice(sdp: string, voice?: string): Promise<void>;
  stopCodexVoice(): Promise<void>;
  appendCodexVoiceText(text: string): Promise<void>;
  archive(request: ArchiveRequest): Promise<unknown>;
  onCodexVoiceEvent(callback: (event: { method?: string; params?: any }) => void): () => void;
  onDoubaoAudio(callback: (audio: Uint8Array) => void): () => void;
  onState(callback: (state: AssistantState) => void): () => void;
  onSignal(callback: (signal: JarvisSignal) => void): () => void;
};

export function validateAction(value: unknown): Action {
  if (!value || typeof value !== 'object') throw new Error('无效请求');
  const a = value as Record<string, any>;
  switch (a.type) {
    case 'stop': case 'exit': case 'minimize': case 'listen': case 'retryVoice': case 'newThread': case 'cancelSpeech': return { type: a.type };
    case 'send': if (typeof a.text === 'string' && a.text.trim() && a.text.length <= 20000) return { type: 'send', text: a.text.trim() }; break;
    case 'pause': if (typeof a.paused === 'boolean') return { type: 'pause', paused: a.paused }; break;
    case 'speak': if (typeof a.text === 'string' && a.text.length <= 1600) return { type: 'speak', text: a.text, preview: a.preview === true }; break;
    case 'voiceError': if (typeof a.message === 'string') return { type: 'voiceError', message: a.message.slice(0, 600) }; break;
    case 'settings': {
      const settings = a.settings;
      const provider = settings?.voiceProvider ?? 'local';
      const providerOk = provider === 'codex' || provider === 'doubao' || provider === 'local';
      const bounded = (value: unknown, max = 4096) => value === undefined || (typeof value === 'string' && value.length <= max);
      if (typeof settings?.cwd === 'string' && typeof settings?.codexPath === 'string' &&
          settings.cwd.length < 4096 && settings.codexPath.length < 4096 && providerOk &&
          bounded(settings.mineradioPath, 4096) &&
          bounded(settings.doubaoApiKey, 512) && bounded(settings.doubaoAsrResourceId, 512) &&
          bounded(settings.doubaoTtsResourceId, 512) && bounded(settings.doubaoVoiceType, 512) &&
          bounded(settings.amapJsApiKey, 512) && bounded(settings.amapSecurityCode, 512) &&
          bounded(settings.qweatherApiHost, 512) && bounded(settings.qweatherApiKey, 512)) {
        if (typeof settings.qweatherApiHost === 'string' && settings.qweatherApiHost && !/^(?:[a-z0-9-]+\.)+qweatherapi\.com$/i.test(settings.qweatherApiHost.trim())) throw new Error('和风天气 API Host 无效');
        return { type: 'settings', settings: {
          cwd: settings.cwd.trim(), codexPath: settings.codexPath.trim(), voiceProvider: provider,
          ...(typeof settings.mineradioPath === 'string' ? { mineradioPath: settings.mineradioPath.trim() } : {}),
          ...(typeof settings.doubaoApiKey === 'string' ? { doubaoApiKey: settings.doubaoApiKey } : {}),
          ...(typeof settings.doubaoAsrResourceId === 'string' ? { doubaoAsrResourceId: settings.doubaoAsrResourceId } : {}),
          ...(typeof settings.doubaoTtsResourceId === 'string' ? { doubaoTtsResourceId: settings.doubaoTtsResourceId } : {}),
          ...(typeof settings.doubaoVoiceType === 'string' ? { doubaoVoiceType: settings.doubaoVoiceType } : {}),
          ...(typeof settings.amapJsApiKey === 'string' && settings.amapJsApiKey.length <= 512 ? { amapJsApiKey: settings.amapJsApiKey } : {}),
          ...(typeof settings.amapSecurityCode === 'string' && settings.amapSecurityCode.length <= 512 ? { amapSecurityCode: settings.amapSecurityCode } : {}),
          ...(typeof settings.qweatherApiHost === 'string' ? { qweatherApiHost: settings.qweatherApiHost.trim().toLowerCase() } : {}),
          ...(typeof settings.qweatherApiKey === 'string' ? { qweatherApiKey: settings.qweatherApiKey } : {}),
        } };
      }
      break;
    }
    case 'respond':
      if ((typeof a.id === 'string' || typeof a.id === 'number') && typeof a.accept === 'boolean') {
        const answers: Record<string, { answers: string[] }> = {};
        if (a.answers) {
          if (typeof a.answers !== 'object' || Object.keys(a.answers).length > 20) break;
          for (const [key, value] of Object.entries(a.answers) as [string, any][]) {
            if (!Array.isArray(value?.answers) || value.answers.length > 20 || value.answers.some((s: unknown) => typeof s !== 'string' || s.length > 10000)) throw new Error('无效答复');
            Object.defineProperty(answers, key, { value: { answers: value.answers }, enumerable: true });
          }
        }
        return { type: 'respond', id: a.id, accept: a.accept, answers };
      }
  }
  throw new Error('无效请求');
}

export function validateArchiveRequest(value: unknown): ArchiveRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('无效档案请求');
  const request = value as Record<string, unknown>;
  const allowed: Record<string, string[]> = {
    listConversations: ['type', 'limit'], searchHistory: ['type', 'query', 'limit'], searchMemories: ['type', 'query', 'limit'],
    listMemories: ['type', 'limit'], deleteConversation: ['type', 'threadId', 'workspace'], deleteMemory: ['type', 'id'], clear: ['type', 'layer'],
  };
  const keys = typeof request.type === 'string' ? allowed[request.type] : undefined;
  if (!keys || Object.keys(request).some(key => !keys.includes(key))) throw new Error('档案请求包含未知字段');
  const boundedText = (name: string, max: number) => {
    const text = request[name];
    if (typeof text !== 'string' || !text.trim() || text.length > max) throw new Error('档案请求文字无效');
    return text.trim();
  };
  const boundedLimit = () => {
    const limit = request.limit ?? 20;
    if (!Number.isInteger(limit) || Number(limit) < 1 || Number(limit) > 100) throw new Error('档案请求数量无效');
    return Number(limit);
  };
  switch (request.type) {
    case 'listConversations': return { type: 'listConversations', limit: boundedLimit() };
    case 'searchHistory': return { type: 'searchHistory', query: boundedText('query', 2000), limit: boundedLimit() };
    case 'searchMemories': return { type: 'searchMemories', query: boundedText('query', 2000), limit: boundedLimit() };
    case 'listMemories': return { type: 'listMemories', limit: boundedLimit() };
    case 'deleteConversation': return { type: 'deleteConversation', threadId: boundedText('threadId', 500), workspace: boundedText('workspace', 4096) };
    case 'deleteMemory': if (Number.isSafeInteger(request.id) && Number(request.id) > 0) return { type: 'deleteMemory', id: Number(request.id) }; break;
    case 'clear': if ((request.layer === 'archive' || request.layer === 'memories') && Object.keys(request).length === 2) return { type: 'clear', layer: request.layer }; break;
  }
  throw new Error('无效档案请求');
}
