import assert from 'node:assert/strict';
import test from 'node:test';
import { validateAction, validateArchiveRequest } from '../electron/protocol.ts';
test('IPC accepts only known actions and bounded user input', () => {
  assert.deepEqual(validateAction({ type: 'send', text: ' 搜索天气 ' }), { type: 'send', text: '搜索天气' });
  assert.throws(() => validateAction({ type: 'exec', command: 'powershell' }));
  assert.throws(() => validateAction({ type: 'send', text: 'x'.repeat(20001) }));
  assert.throws(() => validateAction({ type: 'pause', paused: 'false' }));
});
test('malformed approval input is rejected before reaching the runtime', () => {
  assert.throws(() => validateAction({ type: 'respond', id: '1', accept: true, answers: { question: { answers: [null] } } }));
  assert.deepEqual(validateAction({ type: 'respond', id: 1, accept: false }), { type: 'respond', id: 1, accept: false, answers: {} });
});

test('settings accepts the three voice providers and rejects unknown providers', () => {
  const base = { type: 'settings', settings: { cwd: 'C:/work', codexPath: '' } } as const;
  for (const voiceProvider of ['codex', 'doubao', 'local'] as const) {
    const action = validateAction({ ...base, settings: { ...base.settings, voiceProvider } });
    assert.equal(action.type, 'settings');
    assert.equal(action.settings.voiceProvider, voiceProvider);
  }
  assert.throws(() => validateAction({ ...base, settings: { ...base.settings, voiceProvider: 'unknown' } }));
});

test('settings accepts bounded local AMap credentials and rejects malformed values', () => {
  const base = { type: 'settings', settings: { cwd: 'C:/work', codexPath: '', amapJsApiKey: 'local-key', amapSecurityCode: 'local-secret' } };
  const action = validateAction(base);
  assert.equal(action.type, 'settings');
  assert.equal(action.settings.amapJsApiKey, 'local-key');
  assert.equal(action.settings.amapSecurityCode, 'local-secret');
  assert.throws(() => validateAction({ ...base, settings: { ...base.settings, amapJsApiKey: 'x'.repeat(513) } }));
  assert.throws(() => validateAction({ ...base, settings: { ...base.settings, amapSecurityCode: 3 } }));
  const legacy = validateAction({ type: 'settings', settings: { cwd: 'C:/work', codexPath: '' } });
  assert.equal(legacy.type === 'settings' ? legacy.settings.amapJsApiKey : 'unexpected', undefined);
});

test('settings accepts bounded local QWeather credentials and rejects malformed hosts', () => {
  const value = { type: 'settings', settings: { cwd: 'C:/work', codexPath: '', qweatherApiHost: 'example.qweatherapi.com', qweatherApiKey: 'local-weather-key' } };
  const action = validateAction(value);
  assert.equal(action.type, 'settings');
  assert.equal(action.settings.qweatherApiHost, 'example.qweatherapi.com');
  assert.equal(action.settings.qweatherApiKey, 'local-weather-key');
  assert.throws(() => validateAction({ ...value, settings: { ...value.settings, qweatherApiHost: 'https://example.com/path' } }));
  assert.throws(() => validateAction({ ...value, settings: { ...value.settings, qweatherApiKey: 'x'.repeat(513) } }));
});

test('archive IPC accepts bounded searches and exact delete or clear requests', () => {
  assert.deepEqual(validateArchiveRequest({ type: 'searchHistory', query: '火山语音', limit: 5 }), { type: 'searchHistory', query: '火山语音', limit: 5 });
  assert.deepEqual(validateArchiveRequest({ type: 'deleteConversation', threadId: 'thread-1', workspace: 'C:/work' }), { type: 'deleteConversation', threadId: 'thread-1', workspace: 'C:/work' });
  assert.deepEqual(validateArchiveRequest({ type: 'clear', layer: 'memories' }), { type: 'clear', layer: 'memories' });
  assert.throws(() => validateArchiveRequest({ type: 'searchHistory', query: 'x'.repeat(2001) }));
  assert.throws(() => validateArchiveRequest({ type: 'deleteMemory', id: -1 }));
  assert.throws(() => validateArchiveRequest({ type: 'clear', layer: 'everything' }));
  assert.throws(() => validateArchiveRequest({ type: 'list', sql: 'DROP TABLE turns' }));
  assert.throws(() => validateArchiveRequest({ type: 'deleteMemory', id: 4, extra: true }));
  assert.throws(() => validateArchiveRequest({ type: 'searchHistory', query: '记忆', limit: 5, path: 'C:/private' }));
});
