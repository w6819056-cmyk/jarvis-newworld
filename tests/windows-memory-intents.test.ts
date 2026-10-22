import assert from 'node:assert/strict';
import test from 'node:test';
import { matchMemoryIntent } from '../electron/memory-intents.ts';

test('recognizes explicit Chinese remember instructions and preserves their exact content', () => {
  assert.deepEqual(matchMemoryIntent('记住我喜欢简洁的回答'), { type: 'remember', text: '我喜欢简洁的回答' });
  assert.deepEqual(matchMemoryIntent('请记住：我常用的工作目录是 C:\\Projects'), { type: 'remember', text: '我常用的工作目录是 C:\\Projects' });
});

test('ordinary mentions of remembering do not save a memory', () => {
  for (const text of ['我记得你上次说过这个', '你能记住刚才说的内容吗', '记住这个功能什么时候上线']) {
    assert.equal(matchMemoryIntent(text), undefined);
  }
});

test('recognizes explicit list, forget, and chat history search requests', () => {
  assert.deepEqual(matchMemoryIntent('我让你记住了什么'), { type: 'list' });
  assert.deepEqual(matchMemoryIntent('忘记我喜欢简洁的回答'), { type: 'forget', query: '我喜欢简洁的回答' });
  assert.deepEqual(matchMemoryIntent('搜索以前的聊天：火山语音'), { type: 'search_history', query: '火山语音' });
});

test('rejects blank and overlong explicit memory payloads', () => {
  assert.equal(matchMemoryIntent('记住'), undefined);
  assert.equal(matchMemoryIntent(`记住${'x'.repeat(4001)}`), undefined);
  assert.equal(matchMemoryIntent('忘记'), undefined);
});

test('does not treat unrelated requests as memory commands', () => {
  assert.equal(matchMemoryIntent('帮我打开浏览器搜索天气'), undefined);
  assert.equal(matchMemoryIntent('保存到文件'), undefined);
});
