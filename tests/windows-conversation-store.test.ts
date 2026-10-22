import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ConversationStore } from '../electron/conversation-store.ts';

function withStore(run: (store: ConversationStore) => void) {
  const directory = mkdtempSync(path.join(tmpdir(), 'jarvis-conversation-store-'));
  const store = new ConversationStore(path.join(directory, 'history.sqlite'));
  try { run(store); }
  finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
}

test('opens the same database repeatedly without losing turns or memories', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'jarvis-conversation-store-'));
  const filename = path.join(directory, 'history.sqlite');
  const first = new ConversationStore(filename);
  first.beginTurn({ eventKey: 'typed:1', userText: '你好', timestamp: 10, threadId: 'thread-a', workspace: 'C:/work' });
  first.putMemory('我喜欢简洁回答', null);
  first.close();
  const second = new ConversationStore(filename);
  try {
    assert.equal(second.searchHistory('你好', 10).length, 1);
    assert.equal(second.listMemories(10)[0]?.text, '我喜欢简洁回答');
  } finally { second.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('persists bounded Unicode text and completes a pending turn', () => withStore(store => {
  const result = store.beginTurn({ eventKey: 'voice:1', userText: '你好，贾维斯。', timestamp: 123, threadId: 'thread-中', workspace: 'C:/工作区' });
  assert.equal(result.inserted, true);
  store.completeTurn(result.turnId, '好的，我在。', 456);
  assert.deepEqual(store.searchHistory('贾维斯', 10), [{
    userText: '你好，贾维斯。', assistantText: '好的，我在。', timestamp: 123,
    threadId: 'thread-中', workspace: 'C:/工作区',
  }]);
}));

test('deduplicates an archive event key without replacing its original text', () => withStore(store => {
  const input = { eventKey: 'voice:thread-1:1', userText: '第一句', timestamp: 1, threadId: 'thread-1', workspace: 'C:/work' };
  const first = store.beginTurn(input);
  const second = store.beginTurn({ ...input, userText: '替代文本', timestamp: 2 });
  assert.equal(first.inserted, true);
  assert.equal(second.inserted, false);
  assert.equal(second.turnId, first.turnId);
  assert.equal(store.searchHistory('第一句', 10).length, 1);
}));

test('keyword searches return bounded results and ignore FTS operators as syntax', () => withStore(store => {
  for (let index = 0; index < 30; index++) {
    store.beginTurn({ eventKey: `typed:${index}`, userText: `搜索天气记录 ${index}`, timestamp: index, threadId: 'thread-1', workspace: 'C:/work' });
  }
  assert.equal(store.searchHistory('搜索天气 AND "x', 3).length <= 3, true);
  assert.throws(() => store.searchHistory('天气', 101), /范围/);
}));

test('deletes one thread workspace and clears archive and memories independently', () => withStore(store => {
  store.beginTurn({ eventKey: 'a1', userText: '保留的聊天', timestamp: 1, threadId: 'thread-a', workspace: 'C:/a' });
  store.beginTurn({ eventKey: 'b1', userText: '另一个聊天', timestamp: 2, threadId: 'thread-b', workspace: 'C:/b' });
  store.putMemory('只保留的记忆', null);
  assert.equal(store.deleteConversation('thread-a', 'C:/a'), true);
  assert.equal(store.searchHistory('保留的聊天', 10).length, 0);
  assert.equal(store.listMemories(10).length, 1);
  store.clearMemories();
  assert.equal(store.listMemories(10).length, 0);
  assert.equal(store.searchHistory('另一个聊天', 10).length, 1);
  store.clearArchive();
  assert.equal(store.searchHistory('另一个聊天', 10).length, 0);
}));

test('memory records support parameterized Unicode search, update, and deletion', () => withStore(store => {
  const memory = store.putMemory('记住我偏好蓝色装甲', null);
  const updated = store.putMemory('记住我偏好蓝色装甲', new Float32Array([1, 0]));
  assert.equal(updated.id, memory.id);
  assert.equal(store.findMemories('蓝色装甲', 5)[0]?.text, '记住我偏好蓝色装甲');
  assert.equal(store.deleteMemory(memory.id), true);
  assert.equal(store.findMemories('蓝色装甲', 5).length, 0);
}));

test('refreshes an embedding without changing a memory content timestamp', () => withStore(store => {
  const memory = store.putMemory('我的长期偏好', null);
  store.updateMemoryEmbedding(memory.id, new Float32Array([1, 0]), 'model-v1');
  const refreshed = store.listMemories(5)[0];
  assert.equal(refreshed.updatedAt, memory.updatedAt);
  assert.deepEqual(Array.from(refreshed.embedding ?? []), [1, 0]);
  assert.equal(refreshed.embeddingVersion, 'model-v1');
}));
