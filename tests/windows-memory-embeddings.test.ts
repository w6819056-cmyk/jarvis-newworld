import assert from 'node:assert/strict';
import test from 'node:test';
import type { MemoryRecord } from '../electron/conversation-store.ts';
import { MemoryEmbedder } from '../electron/memory-embeddings.ts';

function record(id: number, text: string, embedding: number[] | null, embeddingVersion = 'jarvis-bge-zh-v1'): MemoryRecord {
  return { id, text, createdAt: id, updatedAt: id, embedding: embedding ? Float32Array.from(embedding) : null, embeddingVersion: embedding ? embeddingVersion : null };
}

test('embeddings are finite and L2 normalized', async () => {
  const embedder = new MemoryEmbedder('C:/models/memory', { pipelineFactory: async () => async text => ({ data: text === 'invalid' ? [Number.NaN] : [3, 4] }) });
  const vector = await embedder.embed('测试');
  assert.ok(Math.abs(vector[0] - 0.6) < 1e-6);
  assert.ok(Math.abs(vector[1] - 0.8) < 1e-6);
  await assert.rejects(embedder.embed('invalid'), /向量/);
});

test('semantic search ranks by cosine similarity and applies a minimum threshold', async () => {
  const embedder = new MemoryEmbedder('C:/models/memory', { pipelineFactory: async () => async text => ({ data: text === 'query' ? [1, 0] : text === 'similar' ? [0.9, 0.1] : [0, 1] }) });
  const results = await embedder.search('query', [record(1, 'similar', [1, 0]), record(2, 'unrelated', [0, 1])], 5);
  assert.deepEqual(results.map(item => item.id), [1]);
});

test('search caps result count and combined memory text length', async () => {
  const embedder = new MemoryEmbedder('C:/models/memory', { pipelineFactory: async () => async () => ({ data: [1, 0] }) });
  const records = Array.from({ length: 8 }, (_, index) => record(index + 1, 'x'.repeat(400), [1, 0]));
  const results = await embedder.search('query', records, 8);
  assert.equal(results.length, 4);
  assert.equal(results.reduce((sum, item) => sum + item.text.length, 0), 1500);
});

test('model pipeline loads once and version or dimension mismatches are re-embedded from text', async () => {
  let loads = 0;
  const embedded: string[] = [];
  const embedder = new MemoryEmbedder('C:/models/memory', { pipelineFactory: async () => {
    loads++;
    return async text => { embedded.push(text); return { data: text === 'query' ? [1, 0] : [0.8, 0.2] }; };
  } });
  const old = record(1, 'old memory', [0.8], 'old-version');
  await embedder.search('query', [old], 5);
  await embedder.search('query', [old], 5);
  assert.equal(loads, 1);
  assert.deepEqual(embedded, ['query', 'old memory', 'query', 'old memory']);
});

test('model load failure is reported so the caller can fall back to keyword search', async () => {
  const embedder = new MemoryEmbedder('C:/models/missing', { pipelineFactory: async () => { throw new Error('model unavailable'); } });
  await assert.rejects(embedder.embed('query'), /model unavailable/);
});
