import assert from 'node:assert/strict';
import test from 'node:test';
import { LocalTools, localToolSpecs } from '../electron/local-tools.ts';
import type { ConversationStore, MemoryRecord } from '../electron/conversation-store.ts';
import type { WeatherResult } from '../electron/weather.ts';
import { UiAutomationSession } from '../electron/ui-automation.ts';
test('web search returns structured results without opening a browser', async () => {
  let opened = '';
  let searched = '';
  const tools = new LocalTools({ openUrl: async url => { opened = url; }, openApp: async () => {}, searchWeb: async query => {
    searched = query;
    return [{ title: '今日车价', url: 'https://example.com/car', snippet: '价格参考' }];
  } });
  const result = await tools.call('jarvis_search_web', { query: '今天汽车价格' });
  assert.equal(result.success, true);
  assert.equal(searched, '今天汽车价格');
  assert.deepEqual(JSON.parse(result.contentItems[0]!.text), [{ title: '今日车价', url: 'https://example.com/car', snippet: '价格参考' }]);
  assert.equal(opened, '');
});

test('video request searches for video and opens the selected safe result', async () => {
  let opened = '';
  let searched = '';
  const tools = new LocalTools({ openUrl: async url => { opened = url; }, openApp: async () => {}, searchWeb: async query => {
    searched = query;
    return [
      { title: 'Iron Man trailer', url: 'https://www.youtube.com/watch?v=abc', snippet: 'Official video' },
      { title: 'Other result', url: 'https://example.com/other', snippet: 'Other' },
    ];
  } });
  const result = await tools.call('jarvis_play_video', { query: '钢铁侠预告片' });
  assert.equal(searched, '钢铁侠预告片 视频');
  assert.equal(opened, 'https://www.youtube.com/watch?v=abc');
  assert.match(result.contentItems[0]!.text, /Iron Man trailer/);
});

test('video request reports no results and never opens a URL', async () => {
  let opened = false;
  const tools = new LocalTools({ openUrl: async () => { opened = true; }, openApp: async () => {}, searchWeb: async () => { throw new Error('没有找到相关搜索结果'); } });
  assert.equal((await tools.call('jarvis_play_video', { query: '不存在的片段' })).success, false);
  assert.equal(opened, false);
});

test('search tools reject extra fields and overlong queries', async () => {
  const tools = new LocalTools({ openUrl: async () => {}, openApp: async () => {}, searchWeb: async () => [] });
  assert.equal((await tools.call('jarvis_search_web', { query: 'query', extra: true })).success, false);
  assert.equal((await tools.call('jarvis_play_video', { query: 'x'.repeat(501) })).success, false);
});

test('search and video tools publish strict bounded schemas', () => {
  for (const name of ['jarvis_search_web', 'jarvis_play_video']) {
    const spec = localToolSpecs.find((item: any) => item.name === name) as any;
    assert.ok(spec);
    assert.equal(spec.inputSchema.additionalProperties, false);
    assert.equal(spec.inputSchema.properties.query.maxLength, 500);
  }
});
test('browser tools reject executable URL schemes and embedded credentials', async () => {
  let calls = 0;
  const tools = new LocalTools({ openUrl: async () => { calls++; }, openApp: async () => {} });
  for (const url of ['file:///C:/a.exe', 'javascript:alert(1)', 'ms-settings:privacy', 'https://user:pass@example.com']) {
    assert.equal((await tools.call('jarvis_open_url', { url })).success, false);
  }
  assert.equal(calls, 0);
});
test('application launch passes a name as data and reports launch failure', async () => {
  let name = '';
  const tools = new LocalTools({ openUrl: async () => {}, openApp: async value => { name = value; throw new Error('未找到应用'); } });
  assert.equal((await tools.call('jarvis_open_app', { name: '豆包' })).success, false);
  assert.equal(name, '豆包');
});

function memory(id: number, text: string): MemoryRecord {
  return { id, text, createdAt: 10, updatedAt: 12, embedding: null, embeddingVersion: null };
}

test('local memory tools expose only bounded schemas with no extra properties', () => {
  const names = localToolSpecs.map((tool: any) => tool.name);
  assert.ok(names.includes('jarvis_list_memories'));
  assert.ok(names.includes('jarvis_search_memories'));
  assert.ok(names.includes('jarvis_search_chat_history'));
  assert.ok(names.includes('jarvis_forget_memory'));
  for (const spec of localToolSpecs.filter((tool: any) => tool.name.startsWith('jarvis_') && tool.name.includes('memor') || tool.name === 'jarvis_search_chat_history')) {
    assert.equal((spec as any).inputSchema.additionalProperties, false);
  }
});

test('memory and archive search tools return bounded excerpts and delete only the selected memory ID', async () => {
  const calls: unknown[] = [];
  const store = {
    listMemories: () => [memory(4, '偏好：中文回答')], findMemories: (_query: string) => [memory(4, '偏好：中文回答')],
    searchHistory: () => [{ userText: '怎样查找以前的记忆？', assistantText: '打开本地对话搜索。', timestamp: 100, threadId: 'thread-1', workspace: 'C:/work' }],
    deleteMemory: (id: number) => { calls.push(id); return id === 4; },
  } as unknown as ConversationStore;
  const tools = new LocalTools({ openUrl: async () => {}, openApp: async () => {}, conversationStore: store });
  const listed = await tools.call('jarvis_list_memories', {});
  assert.equal(listed.success, true);
  assert.match(listed.contentItems[0].text, /偏好：中文回答/);
  const search = await tools.call('jarvis_search_memories', { query: '中文' });
  assert.equal(search.success, true);
  const history = await tools.call('jarvis_search_chat_history', { query: '记忆', limit: 3 });
  assert.equal(history.success, true);
  assert.match(history.contentItems[0].text, /thread-1/);
  assert.equal((await tools.call('jarvis_forget_memory', { id: 4 })).success, true);
  assert.deepEqual(calls, [4]);
});

test('memory tools reject unbounded or malformed arguments and fail cleanly without a store', async () => {
  const tools = new LocalTools({ openUrl: async () => {}, openApp: async () => {} });
  assert.equal((await tools.call('jarvis_search_memories', { query: 'x'.repeat(2001) })).success, false);
  assert.equal((await tools.call('jarvis_search_chat_history', { query: 'hello', limit: 1000 })).success, false);
  assert.equal((await tools.call('jarvis_forget_memory', { id: 1.5 })).success, false);
  assert.equal((await tools.call('jarvis_list_memories', { surprise: 'extra' })).success, false);
});

test('weather tool uses the local lookup for a named or current city without opening a browser', async () => {
  const cities: (string | undefined)[] = [];
  let opened = 0;
  const tools = new LocalTools({
    openUrl: async () => { opened++; }, openApp: async () => {},
    lookupWeather: async city => {
      cities.push(city);
      return { city: city ?? '当前城市', latitude: 30.27, longitude: 120.15, temperature: 21, weatherCode: 1, condition: '天气晴朗', locationMode: city ? 'named' : 'current' } satisfies WeatherResult;
    },
  });
  const named = await tools.call('jarvis_get_weather', { city: '杭州' });
  const current = await tools.call('jarvis_get_weather', {});
  assert.equal(named.success, true);
  assert.match(named.contentItems[0]!.text, /杭州当前天气：天气晴朗/);
  assert.equal(named.display?.kind, 'weather');
  assert.equal(named.display?.weather.city, '杭州');
  assert.match(current.contentItems[0]!.text, /当前城市当前天气：天气晴朗/);
  assert.deepEqual(cities, ['杭州', undefined]);
  assert.equal(opened, 0);
});

test('weather tool exposes a strict bounded city schema and rejects malformed input', async () => {
  const schema = localToolSpecs.find((tool: any) => tool.name === 'jarvis_get_weather') as any;
  assert.ok(schema);
  assert.equal(schema.inputSchema.additionalProperties, false);
  assert.equal(schema.inputSchema.properties.city.maxLength, 80);
  const tools = new LocalTools({ openUrl: async () => {}, openApp: async () => {}, lookupWeather: async () => ({ city: '杭州', latitude: 30, longitude: 120, temperature: 20, weatherCode: 0, condition: '晴朗', locationMode: 'named' }) });
  assert.equal((await tools.call('jarvis_get_weather', { city: '杭'.repeat(81) })).success, false);
  assert.equal((await tools.call('jarvis_get_weather', { city: '杭州', extra: true })).success, false);
  assert.equal((await tools.call('jarvis_get_weather', {})).success, true);
});

test('foreground UI tools expose strict schemas and dispatch one verified action', async () => {
  const specs = localToolSpecs.filter((tool: any) => tool.name.startsWith('jarvis_inspect_foreground_ui') || tool.name.startsWith('jarvis_ui_')) as any[];
  assert.equal(specs.length, 5);
  assert.ok(specs.every(spec => spec.inputSchema.additionalProperties === false));
  const session = new UiAutomationSession({
    inspect: async () => ({ foreground: { handle: '9', title: 'Untitled - Notepad', processName: 'notepad', processId: 9 }, controls: [{ runtimeId: [2], role: 'Edit', name: 'Text editor', enabled: true, focused: true, password: false, patterns: ['setValue'] }] }),
    perform: async () => ({ foregroundHandle: '9', verified: true, state: 'valueLength:4' }),
  });
  const tools = new LocalTools({ openUrl: async () => {}, openApp: async () => {}, uiAutomation: session });
  const inspection = await tools.call('jarvis_inspect_foreground_ui', {});
  const controlId = JSON.parse(inspection.contentItems[0]!.text).controls[0].id;
  assert.equal((await tools.call('jarvis_ui_set_value', { controlId, text: 'test' })).success, true);
  assert.equal((await tools.call('jarvis_ui_set_value', { controlId, text: 'x', extra: true })).success, false);
  assert.equal((await tools.call('jarvis_ui_invoke', { controlId: 'invalid' })).success, false);
});

test('map tools send nearby searches to the internal map module and return bounded summaries', async () => {
  const calls: unknown[] = [];
  let externalLaunches = 0;
  const tools = new LocalTools({
    openUrl: async () => { externalLaunches++; },
    openApp: async () => { externalLaunches++; },
    map: {
      getCurrentLocation: async () => ({ latitude: 34.75, longitude: 113.63, address: '郑州市' }),
      searchNearby: async args => {
        calls.push(args);
        return { places: [{ name: '测试餐馆', address: '测试路 1 号', distanceMeters: 350 }] };
      },
      planRoute: async args => {
        calls.push(args);
        return { status: 'planned', origin: '我的位置', destination: '测试地点', mode: 'drive', distanceMeters: 1000, durationSeconds: 300 };
      },
    },
  });

  const result = await tools.call('jarvis_map_search_nearby', { category: '美食' });

  assert.equal(result.success, true);
  assert.deepEqual(calls, [{ category: '美食' }]);
  assert.match(result.contentItems[0]!.text, /测试餐馆/);
  assert.equal(externalLaunches, 0);
});

test('map route tool keeps route planning inside the map module', async () => {
  const calls: unknown[] = [];
  let externalLaunches = 0;
  const tools = new LocalTools({
    openUrl: async () => { externalLaunches++; }, openApp: async () => { externalLaunches++; },
    map: {
      getCurrentLocation: async () => ({ latitude: 34.75, longitude: 113.63, address: '郑州市' }),
      searchNearby: async () => ({ places: [] }),
      planRoute: async args => {
        calls.push(args);
        return { status: 'planned', origin: '我的位置', destination: '郑州东站', mode: 'walk', distanceMeters: 800, durationSeconds: 600 };
      },
    },
  });

  const result = await tools.call('jarvis_map_plan_route', { destination: '郑州东站', mode: 'walk' });

  assert.equal(result.success, true);
  assert.deepEqual(calls, [{ destination: '郑州东站', mode: 'walk' }]);
  assert.match(result.contentItems[0]!.text, /郑州东站/);
  assert.equal(externalLaunches, 0);
});

test('map tools reject malformed, overlong, and unsupported commands', async () => {
  const tools = new LocalTools({
    openUrl: async () => {}, openApp: async () => {},
    map: { getCurrentLocation: async () => ({ latitude: 34.75, longitude: 113.63, address: '郑州市' }), searchNearby: async () => ({ places: [] }), planRoute: async () => ({ status: 'planned', origin: '我的位置', destination: '郑州东站', mode: 'drive', distanceMeters: 0, durationSeconds: 0 }) },
  });
  assert.equal((await tools.call('jarvis_map_search_nearby', { category: '美食', extra: true })).success, false);
  assert.equal((await tools.call('jarvis_map_search_nearby', { category: 'x'.repeat(201) })).success, false);
  assert.equal((await tools.call('jarvis_map_plan_route', { destination: '郑州东站', mode: 'flight' })).success, false);
  assert.equal((await tools.call('jarvis_map_plan_route', { destination: 'x'.repeat(201) })).success, false);
  assert.equal((await tools.call('jarvis_map_plan_route', { destination: '郑州东站', mode: 'drive', url: 'https://example.com' })).success, false);
});

test('map tools expose strict bounded schemas', () => {
  const nearby = localToolSpecs.find((tool: any) => tool.name === 'jarvis_map_search_nearby') as any;
  const route = localToolSpecs.find((tool: any) => tool.name === 'jarvis_map_plan_route') as any;
  assert.ok(nearby);
  assert.ok(route);
  assert.equal(nearby.inputSchema.additionalProperties, false);
  assert.equal(nearby.inputSchema.properties.category.maxLength, 200);
  assert.equal(route.inputSchema.additionalProperties, false);
  assert.equal(route.inputSchema.properties.destination.maxLength, 200);
  assert.deepEqual(route.inputSchema.properties.mode.enum, ['drive', 'ride', 'walk']);
});
