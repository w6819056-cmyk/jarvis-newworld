import type { MineradioBridge } from './mineradio-bridge';
import type { ConversationStore } from './conversation-store';
import type { MemoryEmbedder } from './memory-embeddings';
import { mineradioActionForTool, mineradioToolSpecs } from './mineradio-bridge';
import type { SearchResult } from './web-search';
import { formatWeatherSpeech, type WeatherResult } from './weather';
import { formatSystemHealth, type SystemHealthReport } from './system-health';
import type { DesktopWindow } from './desktop-control';
import { formatDuplicateScan, type DuplicateScanResult } from './file-tools';
import type { MapController, TravelMode } from '../modules/holo-map/protocol';
import type { UiAutomationSession, UiAction } from './ui-automation';

const memoryToolSpecs = [
  { type: 'function', name: 'jarvis_list_memories', description: '列出用户明确要求贾维斯记住的本地记忆。', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { type: 'function', name: 'jarvis_search_memories', description: '按语义检索用户显式保存的本地记忆；只返回少量相关内容。', inputSchema: { type: 'object', properties: { query: { type: 'string', maxLength: 2000 } }, required: ['query'], additionalProperties: false } },
  { type: 'function', name: 'jarvis_search_chat_history', description: '搜索贾维斯本地文字聊天档案，返回有限匹配片段。', inputSchema: { type: 'object', properties: { query: { type: 'string', maxLength: 2000 }, limit: { type: 'integer', minimum: 1, maximum: 5 } }, required: ['query'], additionalProperties: false } },
  { type: 'function', name: 'jarvis_forget_memory', description: '按本地记忆编号删除一条显式保存的记忆。', inputSchema: { type: 'object', properties: { id: { type: 'integer', minimum: 1 } }, required: ['id'], additionalProperties: false } },
];

export const localToolSpecs = [
  { type: 'function', name: 'jarvis_inspect_foreground_ui', description: '只读检查当前前台应用的可访问控件。返回短时控件编号、角色、名称和支持的单步动作；不要试图操作后台窗口。', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { type: 'function', name: 'jarvis_ui_invoke', description: '对最近一次检查结果中的一个前台控件执行单次 invoke，并核验结果。保存、发送、删除、付款等有副作用的按钮必须先取得用户确认。', inputSchema: { type: 'object', properties: { controlId: { type: 'string', minLength: 16, maxLength: 64 } }, required: ['controlId'], additionalProperties: false } },
  { type: 'function', name: 'jarvis_ui_set_value', description: '向最近一次检查结果中的一个非密码控件设置文本，最多 2000 字符；只执行一次并核验，不保存文件。', inputSchema: { type: 'object', properties: { controlId: { type: 'string', minLength: 16, maxLength: 64 }, text: { type: 'string', maxLength: 2000 } }, required: ['controlId', 'text'], additionalProperties: false } },
  { type: 'function', name: 'jarvis_ui_select', description: '对最近一次检查结果中的一个前台控件执行单次选择并核验。', inputSchema: { type: 'object', properties: { controlId: { type: 'string', minLength: 16, maxLength: 64 } }, required: ['controlId'], additionalProperties: false } },
  { type: 'function', name: 'jarvis_ui_scroll', description: '在最近一次检查结果中的一个控件内滚动 1 到 20 个单位，并核验位置变化。', inputSchema: { type: 'object', properties: { controlId: { type: 'string', minLength: 16, maxLength: 64 }, direction: { type: 'string', enum: ['up', 'down'] }, amount: { type: 'integer', minimum: 1, maximum: 20 } }, required: ['controlId', 'direction', 'amount'], additionalProperties: false } },
  { type: 'function', name: 'jarvis_find_duplicate_files', description: '只读扫描指定绝对目录中的重复文件并返回预览。不会移动、删除或覆盖文件。', inputSchema: { type: 'object', properties: { directories: { type: 'array', minItems: 1, maxItems: 8, items: { type: 'string', minLength: 1, maxLength: 512 } } }, required: ['directories'], additionalProperties: false } },
  { type: 'function', name: 'jarvis_get_audio_status', description: '读取 Windows 默认播放设备的系统音量和静音状态。', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { type: 'function', name: 'jarvis_set_system_volume', description: '设置 Windows 默认播放设备音量，范围 0 到 100。', inputSchema: { type: 'object', properties: { percent: { type: 'number', minimum: 0, maximum: 100 } }, required: ['percent'], additionalProperties: false } },
  { type: 'function', name: 'jarvis_set_system_mute', description: '设置 Windows 默认播放设备静音状态。', inputSchema: { type: 'object', properties: { muted: { type: 'boolean' } }, required: ['muted'], additionalProperties: false } },
  { type: 'function', name: 'jarvis_list_processes', description: '列出当前用户可见的进程，按内存占用排序。只读。', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { type: 'function', name: 'jarvis_terminate_process', description: '结束指定普通进程。必须明确传入 confirm=true；Jarvis、Codex 和系统进程受保护。', inputSchema: { type: 'object', properties: { pid: { type: 'integer', minimum: 5 }, processName: { type: 'string', maxLength: 120 }, confirm: { type: 'boolean' } }, required: ['pid', 'processName', 'confirm'], additionalProperties: false } },
  { type: 'function', name: 'jarvis_get_system_health', description: '只读检查 Windows CPU、内存、磁盘、启动项数量和内存占用最高的进程。不会结束进程或修改系统设置。用户询问电脑状态、电脑健康或资源占用时使用。', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { type: 'function', name: 'jarvis_list_windows', description: '列出当前用户可见的顶层窗口及应用名称。只读，不修改窗口。', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { type: 'function', name: 'jarvis_focus_window', description: '按窗口标题或进程名聚焦一个已经存在的窗口；匹配多个窗口时先询问用户。', inputSchema: { type: 'object', properties: { query: { type: 'string', minLength: 1, maxLength: 200 } }, required: ['query'], additionalProperties: false } },
  { type: 'function', name: 'jarvis_open_system_settings', description: '打开固定的 Windows 设置页面。支持 bluetooth、display、sound、network、apps、startup。不会接受任意协议或路径。', inputSchema: { type: 'object', properties: { target: { type: 'string', enum: ['bluetooth', 'display', 'sound', 'network', 'apps', 'startup'] } }, required: ['target'], additionalProperties: false } },
  { type: 'function', name: 'jarvis_get_weather', description: '查询指定城市或用户当前所在城市的实时天气。用户询问天气时使用，直接返回天气内容，不打开浏览器。未提供城市时自动定位当前城市。', inputSchema: { type: 'object', properties: { city: { type: 'string', maxLength: 80 } }, additionalProperties: false } },
  { type: 'function', name: 'jarvis_open_url', description: '在用户的默认浏览器中打开 HTTP/HTTPS 网页。用户要求打开浏览器时可打开搜索首页。用于打开本机浏览器，不是在线检索工具。', inputSchema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'], additionalProperties: false } },
  { type: 'function', name: 'jarvis_search_web', description: '在网页上检索用户的问题，返回标题、摘要和来源链接。回答时在 Jarvis HUD 中列出有用结果及其来源链接；不要打开浏览器。', inputSchema: { type: 'object', properties: { query: { type: 'string', maxLength: 500 } }, required: ['query'], additionalProperties: false } },
  { type: 'function', name: 'jarvis_play_video', description: '搜索用户指定的视频并在默认浏览器中打开第一个结果。仅在用户明确要求播放或观看视频时调用。', inputSchema: { type: 'object', properties: { query: { type: 'string', maxLength: 500 } }, required: ['query'], additionalProperties: false } },
  { type: 'function', name: 'jarvis_open_app', description: '打开本机已安装的应用。name 为应用名称（如记事本、计算器、豆包），或 exe 完整路径。参数仅用于查找应用，不是命令行。优先于 PowerShell 用于日常打开软件。', inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'], additionalProperties: false } },
  { type: 'function', name: 'jarvis_map_search_nearby', description: '在贾维斯内置地图模块中按当前位置搜索附近地点，例如美食、咖啡馆。会打开或聚焦贾维斯管理的地图窗口，不启动外部软件。', inputSchema: { type: 'object', properties: { category: { type: 'string', maxLength: 200 } }, required: ['category'], additionalProperties: false } },
  { type: 'function', name: 'jarvis_map_plan_route', description: '在贾维斯内置地图模块中规划到指定地点的路线，并显示沉浸地图视角；不打开浏览器或外部地图软件。地点有多个候选时会让用户选择。', inputSchema: { type: 'object', properties: { destination: { type: 'string', maxLength: 200 }, mode: { type: 'string', enum: ['drive', 'ride', 'walk'] } }, required: ['destination'], additionalProperties: false } },
  { type: 'function', name: 'jarvis_find_nearest_rainy_city', description: '根据设备当前位置，在中国城市目录中查找最近的当前降雨城市，并切换 Jarvis 内的 Rainform 雨幕模块。只使用当前实况，不打开外部软件。', inputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false } },
  { type: 'function', name: 'jarvis_show_city_rain', description: '查询指定中国城市当前实况降水并切换 Jarvis 内的 Rainform 雨幕模块。若城市重名，应先询问用户省份。', inputSchema: { type: 'object', properties: { city: { type: 'string', minLength: 1, maxLength: 80 } }, required: ['city'], additionalProperties: false } },
  ...mineradioToolSpecs,
  ...memoryToolSpecs,
];
export type ToolDisplay = { kind: 'weather'; weather: WeatherResult };
export type ToolResult = { success: boolean; contentItems: { type: 'inputText'; text: string }[]; display?: ToolDisplay };
export class LocalTools {
  private readonly disclosedMemoryIds = new Set<number>();
  constructor(private adapter: { openUrl(url: string): Promise<void>; openApp(name: string): Promise<void>; findDuplicates?: (directories: string[]) => Promise<DuplicateScanResult>; getSystemHealth?: () => Promise<SystemHealthReport>; uiAutomation?: UiAutomationSession; desktop?: { listWindows(): Promise<DesktopWindow[]>; focusByQuery(query: string): Promise<boolean>; openSettings(target: string): Promise<string>; getVolume?: () => Promise<{ percent: number; muted: boolean }>; setVolume?: (percent: number) => Promise<{ percent: number; muted: boolean }>; setMuted?: (muted: boolean) => Promise<{ percent: number; muted: boolean }>; listProcesses?: () => Promise<unknown[]>; terminateProcess?: (pid: number, confirmed: boolean, processName?: string) => Promise<boolean> }; openMineradio?: () => Promise<void>; mineradio?: MineradioBridge; map?: MapController; rainform?: { findNearestRainyCity(): Promise<string>; showCityRain(city: string): Promise<string> }; conversationStore?: ConversationStore; memoryEmbedder?: MemoryEmbedder; lookupWeather?: (city?: string) => Promise<WeatherResult>; searchWeb?: (query: string) => Promise<SearchResult[]> }) {}
  async call(tool: string, args: any): Promise<ToolResult> {
    try {
      if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('无效参数');
      const exactKeys = (keys: string[]) => Object.keys(args).length === keys.length && keys.every(key => Object.hasOwn(args, key));
      if (tool === 'jarvis_inspect_foreground_ui') {
        if (!exactKeys([]) || !this.adapter.uiAutomation) throw new Error('前台控件检查服务尚未就绪或参数无效');
        const result = await this.adapter.uiAutomation.inspect();
        return { success: true, contentItems: [{ type: 'inputText', text: JSON.stringify({ foreground: result.foreground, controls: result.controls }) }] };
      }
      if (tool.startsWith('jarvis_ui_')) {
        if (!this.adapter.uiAutomation) throw new Error('前台控件操作服务尚未就绪');
        let action: UiAction;
        if (tool === 'jarvis_ui_invoke' || tool === 'jarvis_ui_select') {
          if (!exactKeys(['controlId']) || typeof args.controlId !== 'string' || !/^[a-f0-9]{24}$/.test(args.controlId)) throw new Error('控件编号无效');
          action = { type: tool === 'jarvis_ui_invoke' ? 'invoke' : 'select' };
        } else if (tool === 'jarvis_ui_set_value') {
          if (!exactKeys(['controlId', 'text']) || typeof args.controlId !== 'string' || !/^[a-f0-9]{24}$/.test(args.controlId) || typeof args.text !== 'string' || args.text.length > 2000) throw new Error('控件编号或文本无效');
          action = { type: 'setValue', text: args.text };
        } else if (tool === 'jarvis_ui_scroll') {
          if (!exactKeys(['controlId', 'direction', 'amount']) || typeof args.controlId !== 'string' || !/^[a-f0-9]{24}$/.test(args.controlId) || !['up', 'down'].includes(args.direction) || !Number.isInteger(args.amount) || args.amount < 1 || args.amount > 20) throw new Error('控件编号或滚动参数无效');
          action = { type: 'scroll', direction: args.direction, amount: args.amount };
        } else throw new Error('不支持的前台控件动作');
        const result = await this.adapter.uiAutomation.act({ controlId: args.controlId, action });
        if (!result.success) throw new Error(result.error ?? '控件操作未完成');
        return { success: true, contentItems: [{ type: 'inputText', text: `动作已核验：${result.state ?? '完成'}` }] };
      }
      if (tool === 'jarvis_find_duplicate_files') {
        if (!exactKeys(['directories']) || !Array.isArray(args.directories) || !args.directories.length || args.directories.length > 8 || args.directories.some((item: unknown) => typeof item !== 'string' || !item.trim() || item.length > 512)) throw new Error('扫描目录参数无效');
        if (!this.adapter.findDuplicates) throw new Error('重复文件扫描服务尚未就绪');
        const directories = args.directories.map((item: string) => item.trim());
        if (directories.some((item: string) => !/^(?:[A-Za-z]:\\|\\\\)/.test(item))) throw new Error('扫描目录必须是 Windows 绝对路径');
        const result = await this.adapter.findDuplicates(directories);
        return { success: true, contentItems: [{ type: 'inputText', text: formatDuplicateScan(result) }] };
      }
      if (tool === 'jarvis_get_audio_status') {
        if (!exactKeys([]) || !this.adapter.desktop?.getVolume) throw new Error('音量服务尚未就绪或参数无效');
        return { success: true, contentItems: [{ type: 'inputText', text: JSON.stringify(await this.adapter.desktop.getVolume()) }] };
      }
      if (tool === 'jarvis_set_system_volume') {
        if (!exactKeys(['percent']) || typeof args.percent !== 'number' || !this.adapter.desktop?.setVolume) throw new Error('音量参数无效');
        return { success: true, contentItems: [{ type: 'inputText', text: JSON.stringify(await this.adapter.desktop.setVolume(args.percent)) }] };
      }
      if (tool === 'jarvis_set_system_mute') {
        if (!exactKeys(['muted']) || typeof args.muted !== 'boolean' || !this.adapter.desktop?.setMuted) throw new Error('静音参数无效');
        return { success: true, contentItems: [{ type: 'inputText', text: JSON.stringify(await this.adapter.desktop.setMuted(args.muted)) }] };
      }
      if (tool === 'jarvis_list_processes') {
        if (!exactKeys([]) || !this.adapter.desktop?.listProcesses) throw new Error('进程服务尚未就绪或参数无效');
        return { success: true, contentItems: [{ type: 'inputText', text: JSON.stringify((await this.adapter.desktop.listProcesses()).slice(0, 50)) }] };
      }
      if (tool === 'jarvis_terminate_process') {
        if (!exactKeys(['pid', 'processName', 'confirm']) || !Number.isSafeInteger(args.pid) || typeof args.processName !== 'string' || typeof args.confirm !== 'boolean' || !this.adapter.desktop?.terminateProcess) throw new Error('结束进程参数无效');
        await this.adapter.desktop.terminateProcess(args.pid, args.confirm, args.processName);
        return { success: true, contentItems: [{ type: 'inputText', text: `已结束进程 ${args.processName}（PID ${args.pid}）` }] };
      }
      if (tool === 'jarvis_get_system_health') {
        if (!exactKeys([])) throw new Error('电脑健康检查不接受参数');
        if (!this.adapter.getSystemHealth) throw new Error('电脑健康检查服务尚未就绪');
        const report = await this.adapter.getSystemHealth();
        return { success: true, contentItems: [{ type: 'inputText', text: formatSystemHealth(report) }] };
      }
      if (tool === 'jarvis_list_windows') {
        if (!exactKeys([])) throw new Error('窗口列表不接受参数');
        if (!this.adapter.desktop) throw new Error('桌面控制服务尚未就绪');
        const windows = await this.adapter.desktop.listWindows();
        return { success: true, contentItems: [{ type: 'inputText', text: JSON.stringify(windows.slice(0, 50)) }] };
      }
      if (tool === 'jarvis_focus_window') {
        if (!exactKeys(['query']) || typeof args.query !== 'string' || !args.query.trim() || args.query.length > 200) throw new Error('窗口名称需为 1 到 200 个字符');
        if (!this.adapter.desktop) throw new Error('桌面控制服务尚未就绪');
        await this.adapter.desktop.focusByQuery(args.query.trim());
        return { success: true, contentItems: [{ type: 'inputText', text: `已聚焦窗口：${args.query.trim()}` }] };
      }
      if (tool === 'jarvis_open_system_settings') {
        if (!exactKeys(['target']) || typeof args.target !== 'string' || !['bluetooth', 'display', 'sound', 'network', 'apps', 'startup'].includes(args.target)) throw new Error('系统设置目标无效');
        if (!this.adapter.desktop) throw new Error('桌面控制服务尚未就绪');
        const result = await this.adapter.desktop.openSettings(args.target);
        return { success: true, contentItems: [{ type: 'inputText', text: result }] };
      }
      if (tool === 'jarvis_get_weather') {
        if (!exactKeys([]) && !exactKeys(['city'])) throw new Error('天气查询参数无效');
        if (args.city !== undefined && (typeof args.city !== 'string' || !args.city.trim() || args.city.length > 80)) throw new Error('城市名称需为 1 到 80 个字符');
        if (!this.adapter.lookupWeather) throw new Error('天气查询服务尚未就绪');
        const result = await this.adapter.lookupWeather(typeof args.city === 'string' ? args.city.trim() : undefined);
        return { success: true, contentItems: [{ type: 'inputText', text: formatWeatherSpeech(result) }], display: { kind: 'weather', weather: result } };
      }
      if (tool === 'jarvis_map_search_nearby') {
        if (!exactKeys(['category']) || typeof args.category !== 'string' || !args.category.trim() || args.category.length > 200) throw new Error('附近地点分类需为 1 到 200 个字符');
        if (!this.adapter.map) throw new Error('贾维斯地图模块尚未就绪');
        const result = await this.adapter.map.searchNearby({ category: args.category.trim() });
        return { success: true, contentItems: [{ type: 'inputText', text: JSON.stringify(result) }] };
      }
      if (tool === 'jarvis_map_plan_route') {
        if (!exactKeys(['destination']) && !exactKeys(['destination', 'mode'])) throw new Error('路线规划参数无效');
        if (typeof args.destination !== 'string' || !args.destination.trim() || args.destination.length > 200) throw new Error('目的地需为 1 到 200 个字符');
        const mode = args.mode === undefined ? 'drive' : args.mode;
        if (mode !== 'drive' && mode !== 'ride' && mode !== 'walk') throw new Error('出行方式仅支持驾车、骑行或步行');
        if (!this.adapter.map) throw new Error('贾维斯地图模块尚未就绪');
        const result = await this.adapter.map.planRoute({ destination: args.destination.trim(), mode: mode as TravelMode });
        return { success: true, contentItems: [{ type: 'inputText', text: JSON.stringify(result) }] };
      }
      if (tool === 'jarvis_find_nearest_rainy_city') {
        if (!exactKeys([])) throw new Error('最近雨城查询参数无效');
        if (!this.adapter.rainform) throw new Error('Rainform 雨幕模块尚未就绪');
        const result = await this.adapter.rainform.findNearestRainyCity();
        return { success: true, contentItems: [{ type: 'inputText', text: result }] };
      }
      if (tool === 'jarvis_show_city_rain') {
        if (!exactKeys(['city']) || typeof args.city !== 'string' || !args.city.trim() || args.city.length > 80) throw new Error('城市名称需为 1 到 80 个字符');
        if (!this.adapter.rainform) throw new Error('Rainform 雨幕模块尚未就绪');
        const result = await this.adapter.rainform.showCityRain(args.city.trim());
        return { success: true, contentItems: [{ type: 'inputText', text: result }] };
      }
      if (tool === 'jarvis_search_web' || tool === 'jarvis_play_video') {
        if (!exactKeys(['query']) || typeof args.query !== 'string' || !args.query.trim() || args.query.length > 500) throw new Error('搜索词需为 1 到 500 个字符');
        if (!this.adapter.searchWeb) throw new Error('网页搜索服务尚未就绪');
        const query = args.query.trim();
        if (tool === 'jarvis_search_web') {
          const results = await this.adapter.searchWeb(query);
          return { success: true, contentItems: [{ type: 'inputText', text: JSON.stringify(results.slice(0, 5).map(({ title, url, snippet }) => ({ title: title.slice(0, 200), url, snippet: snippet.slice(0, 500) }))) }] };
        }
        const results = await this.adapter.searchWeb(`${query.slice(0, 497)} 视频`);
        const selected = results.find(item => {
          try { const url = new URL(item.url); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password; }
          catch { return false; }
        });
        if (!selected) throw new Error('没有找到可播放的视频结果');
        const url = new URL(selected.url).href;
        await this.adapter.openUrl(url);
        return { success: true, contentItems: [{ type: 'inputText', text: JSON.stringify({ message: `已在默认浏览器打开：${selected.title.slice(0, 200)}`, title: selected.title.slice(0, 200), url }) }] };
      }
      if (tool === 'jarvis_list_memories') {
        if (!exactKeys([])) throw new Error('无效参数');
        if (!this.adapter.conversationStore) throw new Error('本地记忆库尚未就绪');
        const records = this.adapter.conversationStore.listMemories(20);
        for (const record of records) this.disclosedMemoryIds.add(record.id);
        return { success: true, contentItems: [{ type: 'inputText', text: JSON.stringify(records.map(({ id, text, updatedAt }) => ({ id, text, updatedAt })).slice(0, 20)) }] };
      }
      if (tool === 'jarvis_search_memories') {
        if (!exactKeys(['query']) || typeof args.query !== 'string' || !args.query.trim() || args.query.length > 2000) throw new Error('无效搜索词');
        if (!this.adapter.conversationStore) throw new Error('本地记忆库尚未就绪');
        const candidates = this.adapter.memoryEmbedder
          ? this.adapter.conversationStore.listMemories(100)
          : this.adapter.conversationStore.findMemories(args.query, 5);
        let results;
        try { results = this.adapter.memoryEmbedder ? await this.adapter.memoryEmbedder.search(args.query, candidates, 5) : candidates.slice(0, 5); }
        catch { results = this.adapter.conversationStore.findMemories(args.query, 5); }
        for (const record of results) this.disclosedMemoryIds.add(record.id);
        return { success: true, contentItems: [{ type: 'inputText', text: JSON.stringify(results.map(({ id, text, updatedAt }) => ({ id, text, updatedAt }))) }] };
      }
      if (tool === 'jarvis_search_chat_history') {
        if (!exactKeys(['query']) && !exactKeys(['query', 'limit'])) throw new Error('无效参数');
        if (typeof args.query !== 'string' || !args.query.trim() || args.query.length > 2000) throw new Error('无效搜索词');
        const limit = args.limit === undefined ? 5 : args.limit;
        if (!Number.isInteger(limit) || limit < 1 || limit > 5) throw new Error('结果数量超出范围');
        if (!this.adapter.conversationStore) throw new Error('本地聊天档案尚未就绪');
        const results = this.adapter.conversationStore.searchHistory(args.query, limit).map(item => ({
          ...item, userText: item.userText.slice(0, 1500), assistantText: item.assistantText.slice(0, 1500),
        }));
        return { success: true, contentItems: [{ type: 'inputText', text: JSON.stringify(results).slice(0, 10000) }] };
      }
      if (tool === 'jarvis_forget_memory') {
        if (!exactKeys(['id']) || !Number.isSafeInteger(args.id) || args.id < 1) throw new Error('无效记忆编号');
        if (!this.adapter.conversationStore) throw new Error('本地记忆库尚未就绪');
        if (!this.disclosedMemoryIds.has(args.id)) throw new Error('请先从记忆列表或搜索结果中选择要删除的记忆');
        const deleted = this.adapter.conversationStore.deleteMemory(args.id);
        if (deleted) this.disclosedMemoryIds.delete(args.id);
        return { success: deleted, contentItems: [{ type: 'inputText', text: deleted ? `已忘记本地记忆 ${args.id}` : '没有找到该编号的本地记忆' }] };
      }
      if (tool === 'jarvis_open_url') {
        let value: string;
        if (typeof args.url !== 'string' || args.url.length > 8000) throw new Error('无效网址');
        const url = new URL(args.url);
        if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('只允许普通 HTTP/HTTPS 网页');
        value = url.href;
        await this.adapter.openUrl(value);
        return { success: true, contentItems: [{ type: 'inputText', text: '系统已接受在默认浏览器打开网页的请求；未读取或验证页面内容。' }] };
      }
      if (tool === 'jarvis_open_app') {
        if (typeof args.name !== 'string' || !args.name.trim() || args.name.length > 4096) throw new Error('无效应用名称');
        await this.adapter.openApp(args.name.trim());
        return { success: true, contentItems: [{ type: 'inputText', text: '系统已接受启动应用的请求；未验证应用界面是否完全加载。' }] };
      }
      if (tool.startsWith('jarvis_mineradio_')) {
        const bridge = this.adapter.mineradio;
        if (!bridge) throw new Error('Mineradio 控制桥尚未连接，请先说“打开音乐播放器”');
        if (!bridge.connected && this.adapter.openMineradio) await this.adapter.openMineradio();
        const action = mineradioActionForTool(tool);
        if (!action) throw new Error('不支持的 Mineradio 操作');
        const result = await bridge.request(action, args);
        if (!result.success) return { success: false, contentItems: [{ type: 'inputText', text: result.error?.message ?? 'Mineradio 执行失败' }] };
        return { success: true, contentItems: [{ type: 'inputText', text: JSON.stringify(result.result ?? {}) }] };
      }
      throw new Error('不支持的本地工具');
    } catch (error) { return { success: false, contentItems: [{ type: 'inputText', text: error instanceof Error ? error.message : String(error) }] }; }
  }
}
