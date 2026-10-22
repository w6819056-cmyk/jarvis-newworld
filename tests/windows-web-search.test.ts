import assert from 'node:assert/strict';
import test from 'node:test';
import { searchWeb } from '../electron/web-search.ts';

function response(html: string, status = 200): Response {
  return new Response(html, { status, headers: { 'content-type': 'text/html' } });
}

test('searchWeb extracts result title, URL, and snippet from search HTML', async () => {
  const result = await searchWeb('jarvis armor', {
    fetchImpl: async () => response('<div class="result"><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fitem">Iron &amp; Man</a><a class="result__snippet">A &quot;metal&quot; suit</a></div>'),
  });
  assert.deepEqual(result, [{ title: 'Iron & Man', url: 'https://example.com/item', snippet: 'A "metal" suit' }]);
});

test('searchWeb returns at most five bounded results and ignores unsafe URLs', async () => {
  const blocks = Array.from({ length: 8 }, (_, index) => `<div class="result"><a class="result__a" href="${index === 1 ? 'javascript:alert(1)' : index === 2 ? 'https://user:pass@example.com/unsafe' : `https://example.com/${index}`}">${'T'.repeat(240)}</a><a class="result__snippet">${'S'.repeat(600)}</a></div>`).join('');
  const results = await searchWeb('items', { fetchImpl: async () => response(blocks) });
  assert.equal(results.length, 5);
  assert.equal(results[0]?.title.length, 200);
  assert.equal(results[0]?.snippet.length, 500);
  assert.deepEqual(results.map(item => item.url), ['https://example.com/0', 'https://example.com/3', 'https://example.com/4', 'https://example.com/5', 'https://example.com/6']);
});

test('searchWeb rejects empty and overlong queries before making a request', async () => {
  let requests = 0;
  const fetchImpl = async () => { requests++; return response(''); };
  await assert.rejects(searchWeb('  ', { fetchImpl }), /搜索词/);
  await assert.rejects(searchWeb('q'.repeat(501), { fetchImpl }), /搜索词/);
  assert.equal(requests, 0);
});

test('searchWeb reports empty and unsuccessful responses', async () => {
  await assert.rejects(searchWeb('none', { fetchImpl: async () => response('<html>no results</html>') }), /没有找到/);
  await assert.rejects(searchWeb('error', { fetchImpl: async () => response('unavailable', 503) }), /503/);
  await assert.rejects(searchWeb('offline', { fetchImpl: async () => { throw new TypeError('fetch failed'); } }), /网页搜索连接失败/);
});

test('searchWeb rejects unexpectedly large HTML responses', async () => {
  await assert.rejects(searchWeb('large', { fetchImpl: async () => response(`<html>${'x'.repeat(1_000_001)}</html>`) }), /响应过大/);
});

test('searchWeb aborts a request after its timeout', async () => {
  await assert.rejects(searchWeb('slow', {
    timeoutMs: 5,
    fetchImpl: async (_url, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }),
  }), /超时/);
});
