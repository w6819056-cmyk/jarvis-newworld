import type { MemoryRecord } from './conversation-store';

export const MEMORY_EMBEDDING_VERSION = 'bge-small-zh-v1.5-q8-75c43b069aac';
const MAX_RESULTS = 5;
const MAX_RESULT_TEXT = 1500;
const MIN_SIMILARITY = 0.45;

type FeaturePipeline = (text: string, options?: Record<string, unknown>) => Promise<{ data: ArrayLike<number> }>;
type PipelineFactory = (modelDir: string) => Promise<FeaturePipeline>;

async function loadFeaturePipeline(modelDir: string): Promise<FeaturePipeline> {
  const load = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<typeof import('@huggingface/transformers')>;
  const transformers = await load('@huggingface/transformers');
  const pipeline = await transformers.pipeline('feature-extraction', modelDir, {
    device: 'cpu', dtype: 'q8', local_files_only: true,
  });
  return (text, options) => pipeline(text, options) as Promise<{ data: ArrayLike<number> }>;
}

function normalize(values: ArrayLike<number>): Float32Array {
  if (!values.length) throw new Error('模型返回空向量');
  const vector = Float32Array.from(values);
  let norm = 0;
  for (const value of vector) {
    if (!Number.isFinite(value)) throw new Error('模型返回无效向量');
    norm += value * value;
  }
  if (!Number.isFinite(norm) || norm <= 0) throw new Error('模型返回零向量');
  const scale = 1 / Math.sqrt(norm);
  for (let index = 0; index < vector.length; index++) vector[index] *= scale;
  return vector;
}

function cosine(left: Float32Array, right: Float32Array): number {
  if (left.length !== right.length) return -1;
  let score = 0;
  for (let index = 0; index < left.length; index++) score += left[index] * right[index];
  return score;
}

export class MemoryEmbedder {
  private pipelinePromise?: Promise<FeaturePipeline>;

  constructor(
    private readonly modelDir: string,
    private readonly options: { pipelineFactory?: PipelineFactory; minimumSimilarity?: number; onReembedded?: (record: MemoryRecord) => void | Promise<void> } = {},
  ) {}

  private getPipeline(): Promise<FeaturePipeline> {
    this.pipelinePromise ??= (this.options.pipelineFactory ?? loadFeaturePipeline)(this.modelDir);
    return this.pipelinePromise;
  }

  async embed(text: string): Promise<Float32Array> {
    const value = text.trim();
    if (!value || value.length > 20000) throw new Error('嵌入文字为空或过长');
    const result = await (await this.getPipeline())(value, { pooling: 'mean', normalize: false });
    return normalize(result.data);
  }

  async search(query: string, records: MemoryRecord[], limit: number): Promise<MemoryRecord[]> {
    if (!Number.isInteger(limit) || limit < 1) throw new Error('记忆结果数量无效');
    const queryVector = await this.embed(query);
    const threshold = this.options.minimumSimilarity ?? MIN_SIMILARITY;
    const ranked: Array<{ record: MemoryRecord; score: number }> = [];
    for (const record of records) {
      const current = record.embedding;
      const embedding = current && current.length === queryVector.length && record.embeddingVersion === MEMORY_EMBEDDING_VERSION
        ? current
        : await this.embed(record.text);
      if (embedding !== current) {
        const refreshed = { ...record, embedding, embeddingVersion: MEMORY_EMBEDDING_VERSION };
        await this.options.onReembedded?.(refreshed);
      }
      const score = cosine(queryVector, embedding);
      if (score >= threshold) ranked.push({ record: { ...record, embedding, embeddingVersion: MEMORY_EMBEDDING_VERSION }, score });
    }
    ranked.sort((left, right) => right.score - left.score || right.record.updatedAt - left.record.updatedAt);
    let remaining = MAX_RESULT_TEXT;
    const results: MemoryRecord[] = [];
    for (const item of ranked.slice(0, Math.min(limit, MAX_RESULTS))) {
      if (remaining <= 0) break;
      const text = item.record.text.slice(0, remaining);
      remaining -= text.length;
      results.push({ ...item.record, text });
    }
    return results;
  }
}
