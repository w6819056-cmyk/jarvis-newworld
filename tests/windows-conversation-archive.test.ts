import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ConversationStore } from '../electron/conversation-store.ts';
import { ConversationArchive } from '../electron/conversation-archive.ts';

test('pairs finalized user and assistant text by thread and leaves interrupted turns incomplete', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'jarvis-conversation-archive-'));
  const store = new ConversationStore(path.join(directory, 'history.sqlite'));
  const archive = new ConversationArchive(store);
  try {
    archive.beginUser({ text: '第一句', threadId: 'thread-a', workspace: 'C:/work', source: 'typed', timestamp: 10 });
    archive.completeAssistant('thread-a', '第一条回复', 20);
    archive.beginUser({ text: '第二句', threadId: 'thread-a', workspace: 'C:/work', source: 'voice', timestamp: 30 });
    archive.failPending('thread-a');
    archive.beginUser({ text: '另一线程', threadId: 'thread-b', workspace: 'C:/other', source: 'voice', timestamp: 40 });
    archive.completeAssistant('thread-b', '另一线程回复', 50);

    assert.deepEqual(store.searchHistory('第一句', 5).map(row => row.assistantText), ['第一条回复']);
    assert.deepEqual(store.searchHistory('第二句', 5).map(row => row.assistantText), ['']);
    assert.deepEqual(store.searchHistory('另一线程', 5).map(row => row.assistantText), ['另一线程回复']);
    assert.equal(archive.completeAssistant('thread-a', '迟到的错误回复', 60), false);
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('keeps turn event keys unique for identical repeated utterances', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'jarvis-conversation-archive-'));
  const store = new ConversationStore(path.join(directory, 'history.sqlite'));
  const archive = new ConversationArchive(store);
  try {
    archive.beginUser({ text: '相同的话', threadId: 'thread-a', workspace: 'C:/work', source: 'voice', timestamp: 10 });
    archive.beginUser({ text: '相同的话', threadId: 'thread-a', workspace: 'C:/work', source: 'voice', timestamp: 10 });
    assert.equal(store.searchHistory('相同的话', 10).length, 2);
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});
