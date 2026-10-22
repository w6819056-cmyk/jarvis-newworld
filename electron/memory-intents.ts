const MAX_MEMORY_TEXT = 4000;
const MAX_QUERY = 2000;

function clean(value: string, max: number): string | undefined {
  const text = value.trim().replace(/[\u0000-\u001f\u007f]/g, ' ');
  return text && text.length <= max ? text : undefined;
}

export type MemoryIntent =
  | { type: 'remember'; text: string }
  | { type: 'list' }
  | { type: 'forget'; query: string }
  | { type: 'search_history'; query: string };

export function matchMemoryIntent(input: string): MemoryIntent | undefined {
  const text = input.trim();
  if (!text || text.length > 20000) return undefined;
  const remember = text.match(/^(?:请)?记住(.+)$/u);
  if (remember) {
    const payload = remember[1].replace(/^[：:，,、\s]*/u, '');
    const value = clean(payload, MAX_MEMORY_TEXT);
    if (/[？?]$|(?:吗|么|什么时候|是否|能不能|可不可以)/u.test(value ?? '')) return undefined;
    return value ? { type: 'remember', text: value } : undefined;
  }
  if (/^(?:我让你)?记住了什么[？?。!！]?$/u.test(text) || /^你记住了什么[？?。!！]?$/u.test(text)) return { type: 'list' };
  const forget = text.match(/^(?:请)?忘记(.+)$/u);
  if (forget) {
    const payload = forget[1].replace(/^[：:，,、\s]*/u, '');
    const query = clean(payload, MAX_QUERY);
    return query ? { type: 'forget', query } : undefined;
  }
  const search = text.match(/^搜索以前的聊天(?:记录)?(?:[：:，,、\s]+)(.+)$/u);
  if (search) {
    const query = clean(search[1], MAX_QUERY);
    return query ? { type: 'search_history', query } : undefined;
  }
  return undefined;
}
