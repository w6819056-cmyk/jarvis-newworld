export type SearchResult = { title: string; url: string; snippet: string };

type SearchOptions = { fetchImpl?: typeof fetch; timeoutMs?: number };
const MAX_RESPONSE_BYTES = 1_000_000;

async function readResponse(response: Response): Promise<string> {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) throw new Error('搜索响应过大');
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel().catch(() => {});
      throw new Error('搜索响应过大');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(bytes);
}

function decodeHtml(value: string): string {
  return value
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_match, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/\s+/g, ' ')
    .trim();
}

function resultUrl(raw: string): string | undefined {
  try {
    const parsed = new URL(raw, 'https://html.duckduckgo.com');
    if (parsed.hostname === 'duckduckgo.com' && parsed.pathname === '/l/') {
      const target = parsed.searchParams.get('uddg') ?? parsed.searchParams.get('url');
      if (target) return resultUrl(target);
    }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return undefined;
    return parsed.href;
  } catch { return undefined; }
}

export async function searchWeb(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
  const normalized = typeof query === 'string' ? query.trim() : '';
  if (!normalized || normalized.length > 500) throw new Error('搜索词需为 1 到 500 个字符');
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 8000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(normalized)}`, {
      signal: controller.signal,
      headers: { 'user-agent': 'Jarvis/0.3 (+local desktop assistant)' },
    });
    if (!response.ok) throw new Error(`搜索服务返回 HTTP ${response.status}`);
    const html = await readResponse(response);
    const links = [...html.matchAll(/<a\b([^>]*\bclass\s*=\s*["'][^"']*\bresult__a\b[^"']*["'][^>]*)>([\s\S]*?)<\/a>/gi)];
    const snippets = [...html.matchAll(/<a\b([^>]*\bclass\s*=\s*["'][^"']*\bresult__snippet\b[^"']*["'][^>]*)>([\s\S]*?)<\/a>/gi)];
    const results: SearchResult[] = [];
    for (const [index, match] of links.entries()) {
      const href = match[1]?.match(/\bhref\s*=\s*(["'])(.*?)\1/i)?.[2];
      const url = href ? resultUrl(decodeHtml(href)) : undefined;
      const title = decodeHtml(match[2] ?? '');
      if (!url || !title) continue;
      results.push({
        title: title.slice(0, 200),
        url,
        snippet: decodeHtml(snippets[index]?.[2] ?? '').slice(0, 500),
      });
      if (results.length === 5) break;
    }
    if (!results.length) throw new Error('没有找到相关搜索结果');
    return results;
  } catch (error) {
    if (controller.signal.aborted) throw new Error('网页搜索超时，请稍后重试');
    if (error instanceof TypeError) throw new Error('网页搜索连接失败，请检查网络后重试');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
