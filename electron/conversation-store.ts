import { DatabaseSync, type SQLOutputValue } from 'node:sqlite';

export type MemoryRecord = {
  id: number;
  text: string;
  createdAt: number;
  updatedAt: number;
  embedding: Float32Array | null;
  embeddingVersion: string | null;
};

export type HistoryRecord = {
  userText: string;
  assistantText: string;
  timestamp: number;
  threadId: string;
  workspace: string;
};

export type ConversationSummary = { threadId: string; workspace: string; timestamp: number; preview: string; turnCount: number };

const MAX_TURN_TEXT = 30000;
const MAX_MEMORY_TEXT = 4000;
const MAX_HISTORY_RESULTS = 100;
const MAX_MEMORY_RESULTS = 100;

function boundedLimit(limit: number, max: number): number {
  if (!Number.isInteger(limit) || limit < 1 || limit > max) throw new Error('结果数量超出范围');
  return limit;
}

function boundedText(value: string, label: string, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`${label}为空或超出长度限制`);
  return value.trim();
}

function ftsPhrase(value: string): string {
  return `"${value.trim().replaceAll('"', '""')}"`;
}

function likePattern(value: string): string {
  return `%${value.replace(/[\\%_]/g, character => `\\${character}`)}%`;
}

function readMemory(row: Record<string, SQLOutputValue>): MemoryRecord {
  const blob = row.embedding;
  const bytes = blob instanceof Uint8Array ? blob : null;
  const embedding = bytes && bytes.byteLength % Float32Array.BYTES_PER_ELEMENT === 0
    ? new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
    : null;
  return {
    id: Number(row.id), text: String(row.text), createdAt: Number(row.created_at), updatedAt: Number(row.updated_at),
    embedding, embeddingVersion: typeof row.embedding_version === 'string' ? row.embedding_version : null,
  };
}

function encodeEmbedding(embedding: Float32Array | null): Uint8Array | null {
  if (embedding === null) return null;
  if (!(embedding instanceof Float32Array) || !embedding.length || Array.from(embedding).some(value => !Number.isFinite(value))) throw new Error('记忆向量无效');
  return new Uint8Array(embedding.buffer.slice(embedding.byteOffset, embedding.byteOffset + embedding.byteLength));
}

export class ConversationStore {
  private readonly db: DatabaseSync;
  private closed = false;

  constructor(filename: string) {
    if (!filename.trim()) throw new Error('数据库路径不能为空');
    this.db = new DatabaseSync(filename);
    this.db.exec('PRAGMA foreign_keys = ON');
    const version = Number(this.db.prepare('PRAGMA user_version').get()?.user_version ?? 0);
    if (version < 1) {
      this.db.exec(`
        BEGIN;
        CREATE TABLE turns (
          id INTEGER PRIMARY KEY,
          event_key TEXT NOT NULL UNIQUE,
          user_text TEXT NOT NULL,
          assistant_text TEXT NOT NULL DEFAULT '',
          timestamp INTEGER NOT NULL,
          completed_at INTEGER,
          thread_id TEXT NOT NULL,
          workspace TEXT NOT NULL
        );
        CREATE VIRTUAL TABLE history_search USING fts5(user_text, assistant_text, content='turns', content_rowid='id');
        CREATE TRIGGER turns_ai AFTER INSERT ON turns BEGIN
          INSERT INTO history_search(rowid, user_text, assistant_text) VALUES (new.id, new.user_text, new.assistant_text);
        END;
        CREATE TRIGGER turns_ad AFTER DELETE ON turns BEGIN
          INSERT INTO history_search(history_search, rowid, user_text, assistant_text) VALUES ('delete', old.id, old.user_text, old.assistant_text);
        END;
        CREATE TRIGGER turns_au AFTER UPDATE OF user_text, assistant_text ON turns BEGIN
          INSERT INTO history_search(history_search, rowid, user_text, assistant_text) VALUES ('delete', old.id, old.user_text, old.assistant_text);
          INSERT INTO history_search(rowid, user_text, assistant_text) VALUES (new.id, new.user_text, new.assistant_text);
        END;
        CREATE TABLE memories (
          id INTEGER PRIMARY KEY,
          text TEXT NOT NULL UNIQUE,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          embedding BLOB,
          embedding_version TEXT
        );
        CREATE VIRTUAL TABLE memory_search USING fts5(text, content='memories', content_rowid='id');
        CREATE TRIGGER memories_ai AFTER INSERT ON memories BEGIN
          INSERT INTO memory_search(rowid, text) VALUES (new.id, new.text);
        END;
        CREATE TRIGGER memories_ad AFTER DELETE ON memories BEGIN
          INSERT INTO memory_search(memory_search, rowid, text) VALUES ('delete', old.id, old.text);
        END;
        CREATE TRIGGER memories_au AFTER UPDATE OF text ON memories BEGIN
          INSERT INTO memory_search(memory_search, rowid, text) VALUES ('delete', old.id, old.text);
          INSERT INTO memory_search(rowid, text) VALUES (new.id, new.text);
        END;
        PRAGMA user_version = 1;
        COMMIT;
      `);
    }
  }

  beginTurn(input: { eventKey: string; userText: string; timestamp: number; threadId: string; workspace: string }): { turnId: number; inserted: boolean } {
    const eventKey = boundedText(input.eventKey, '事件编号', 500);
    const userText = boundedText(input.userText, '用户文字', MAX_TURN_TEXT);
    const threadId = boundedText(input.threadId, '线程编号', 500);
    const workspace = boundedText(input.workspace, '工作目录', 4096);
    if (!Number.isSafeInteger(input.timestamp) || input.timestamp < 0) throw new Error('时间戳无效');
    const result = this.db.prepare(`INSERT INTO turns(event_key, user_text, timestamp, thread_id, workspace)
      VALUES (?, ?, ?, ?, ?) ON CONFLICT(event_key) DO NOTHING`).run(eventKey, userText, input.timestamp, threadId, workspace);
    const row = this.db.prepare('SELECT id FROM turns WHERE event_key = ?').get(eventKey);
    if (!row) throw new Error('无法读取新建对话记录');
    return { turnId: Number(row.id), inserted: Number(result.changes) === 1 };
  }

  completeTurn(turnId: number, assistantText: string, completedAt: number): void {
    if (!Number.isSafeInteger(turnId) || turnId < 1) throw new Error('对话编号无效');
    const text = assistantText.length ? assistantText.slice(0, MAX_TURN_TEXT).trim() : '';
    if (!Number.isSafeInteger(completedAt) || completedAt < 0) throw new Error('完成时间无效');
    const result = this.db.prepare('UPDATE turns SET assistant_text = ?, completed_at = ? WHERE id = ?').run(text, completedAt, turnId);
    if (Number(result.changes) !== 1) throw new Error('对话记录不存在');
  }

  searchHistory(query: string, limit: number): HistoryRecord[] {
    const value = boundedText(query, '搜索词', 2000);
    const count = boundedLimit(limit, MAX_HISTORY_RESULTS);
    const rows = this.db.prepare(`SELECT turns.user_text, turns.assistant_text, turns.timestamp, turns.thread_id, turns.workspace
      FROM history_search JOIN turns ON turns.id = history_search.rowid
      WHERE history_search MATCH ? ORDER BY rank LIMIT ?`).all(ftsPhrase(value), count).map(row => ({
      userText: String(row.user_text), assistantText: String(row.assistant_text), timestamp: Number(row.timestamp),
      threadId: String(row.thread_id), workspace: String(row.workspace),
    }));
    if (rows.length) return rows;
    return this.db.prepare(`SELECT user_text, assistant_text, timestamp, thread_id, workspace FROM turns
      WHERE user_text LIKE ? ESCAPE '\\' OR assistant_text LIKE ? ESCAPE '\\' ORDER BY timestamp DESC LIMIT ?`)
      .all(likePattern(value), likePattern(value), count).map(row => ({
        userText: String(row.user_text), assistantText: String(row.assistant_text), timestamp: Number(row.timestamp),
        threadId: String(row.thread_id), workspace: String(row.workspace),
      }));
  }

  searchMemories(query: string, limit: number): MemoryRecord[] {
    const value = boundedText(query, '搜索词', 2000);
    const count = boundedLimit(limit, MAX_MEMORY_RESULTS);
    const fts = this.db.prepare(`SELECT memories.id, memories.text, memories.created_at, memories.updated_at, memories.embedding, memories.embedding_version
      FROM memory_search JOIN memories ON memories.id = memory_search.rowid
      WHERE memory_search MATCH ? ORDER BY rank LIMIT ?`).all(ftsPhrase(value), count).map(readMemory);
    if (fts.length) return fts;
    return this.db.prepare(`SELECT id, text, created_at, updated_at, embedding, embedding_version FROM memories
      WHERE text LIKE ? ESCAPE '\\' ORDER BY updated_at DESC LIMIT ?`).all(likePattern(value), count).map(readMemory);
  }

  listConversations(limit: number): ConversationSummary[] {
    const count = boundedLimit(limit, MAX_HISTORY_RESULTS);
    return this.db.prepare(`SELECT thread_id, workspace, MAX(timestamp) AS timestamp,
      MAX(substr(user_text, 1, 240)) AS preview, COUNT(*) AS turn_count
      FROM turns GROUP BY thread_id, workspace ORDER BY timestamp DESC LIMIT ?`).all(count).map(row => ({
      threadId: String(row.thread_id), workspace: String(row.workspace), timestamp: Number(row.timestamp),
      preview: String(row.preview), turnCount: Number(row.turn_count),
    }));
  }

  listMemories(limit: number): MemoryRecord[] {
    const count = boundedLimit(limit, MAX_MEMORY_RESULTS);
    return this.db.prepare('SELECT id, text, created_at, updated_at, embedding, embedding_version FROM memories ORDER BY updated_at DESC, id DESC LIMIT ?')
      .all(count).map(readMemory);
  }

  findMemories(query: string, limit: number): MemoryRecord[] {
    return this.searchMemories(query, limit);
  }

  putMemory(text: string, embedding: Float32Array | null, embeddingVersion: string | null = null): MemoryRecord {
    const value = boundedText(text, '记忆内容', MAX_MEMORY_TEXT);
    const vector = encodeEmbedding(embedding);
    if (embeddingVersion !== null && (typeof embeddingVersion !== 'string' || embeddingVersion.length > 200)) throw new Error('向量版本无效');
    const now = Date.now();
    this.db.prepare(`INSERT INTO memories(text, created_at, updated_at, embedding, embedding_version) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(text) DO UPDATE SET updated_at = excluded.updated_at, embedding = excluded.embedding, embedding_version = excluded.embedding_version`)
      .run(value, now, now, vector, embeddingVersion);
    const row = this.db.prepare('SELECT id, text, created_at, updated_at, embedding, embedding_version FROM memories WHERE text = ?').get(value);
    if (!row) throw new Error('无法读取已保存记忆');
    return readMemory(row);
  }

  updateMemoryEmbedding(id: number, embedding: Float32Array, embeddingVersion: string): void {
    if (!Number.isSafeInteger(id) || id < 1 || !embeddingVersion || embeddingVersion.length > 200) throw new Error('记忆向量信息无效');
    const vector = encodeEmbedding(embedding);
    const result = this.db.prepare('UPDATE memories SET embedding = ?, embedding_version = ? WHERE id = ?').run(vector, embeddingVersion, id);
    if (Number(result.changes) !== 1) throw new Error('记忆记录不存在');
  }

  deleteMemory(id: number): boolean {
    if (!Number.isSafeInteger(id) || id < 1) throw new Error('记忆编号无效');
    return Number(this.db.prepare('DELETE FROM memories WHERE id = ?').run(id).changes) === 1;
  }

  deleteConversation(threadId: string, workspace: string): boolean {
    const result = this.db.prepare('DELETE FROM turns WHERE thread_id = ? AND workspace = ?').run(
      boundedText(threadId, '线程编号', 500), boundedText(workspace, '工作目录', 4096));
    return Number(result.changes) > 0;
  }

  clearArchive(): void {
    this.db.exec('DELETE FROM turns');
  }

  clearMemories(): void {
    this.db.exec('DELETE FROM memories');
  }

  close(): void {
    if (this.closed) return;
    this.db.close();
    this.closed = true;
  }
}
