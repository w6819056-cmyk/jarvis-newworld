const OPEN_MINERADIO_PHRASE = '咱们开启音乐播放器';

const PRESET_ALIASES: Array<{ id: number; names: string[] }> = [
  { id: 0, names: ['emily专辑封面', 'emily专辑', 'emily'] },
  { id: 1, names: ['滚筒'] },
  { id: 2, names: ['星球'] },
  { id: 3, names: ['虚空'] },
  { id: 4, names: ['唱片'] },
  { id: 5, names: ['星河'] },
  { id: 6, names: ['安魂'] },
  { id: 7, names: ['音域回响'] },
  { id: 8, names: ['音域回响 wallpaper engine', '壁纸引擎音域回响'] },
  { id: 9, names: ['月蚀圣环', '月蚀'] },
  { id: 10, names: ['雨幕霓虹'] },
  { id: 11, names: ['折光蝶群'] },
  { id: 12, names: ['深海绽放'] },
];
const PRESET_SWITCH_VERBS = ['切换到', '切换为', '切换成', '切到', '换成', '换到', '改成', '设置为', '设置成'];

export type MineradioDirectCommand = {
  action: 'player.get_state' | 'player.pause' | 'player.resume' | 'player.next' | 'player.previous' | 'player.set_volume';
  payload: Record<string, unknown>;
};

function normalizeVisualCommand(value: string) {
  return value.normalize('NFC').toLocaleLowerCase().replace(/[\p{P}\p{S}\p{Z}\s]/gu, '');
}

export function shouldOpenMineradioFromTranscript(text: string, final: boolean) {
  if (!final) return false;
  return text.normalize('NFC').replace(/[\p{P}\p{Z}\s]/gu, '') === OPEN_MINERADIO_PHRASE;
}

export function matchMineradioDirectCommand(text: string): MineradioDirectCommand | undefined {
  const normalized = normalizeVisualCommand(text);
  if (/^(?:暂停音乐|暂停播放|暂停一下|暂停)$/.test(normalized)) return { action: 'player.pause', payload: {} };
  if (/^(?:继续播放|继续音乐|恢复播放)$/.test(normalized)) return { action: 'player.resume', payload: {} };
  if (/^(?:下一首|下一首歌|换一首)$/.test(normalized)) return { action: 'player.next', payload: {} };
  if (/^(?:上一首|上一首歌|回到上一首)$/.test(normalized)) return { action: 'player.previous', payload: {} };
  if (/^(?:现在放的是什么|当前播放什么|正在播放什么|播放状态)$/.test(normalized)) return { action: 'player.get_state', payload: {} };
  const volume = normalized.match(/^(?:把)?音量(?:调到|设置为|设为)(\d{1,3})$/);
  if (volume) {
    const value = Number(volume[1]);
    if (value >= 0 && value <= 100) return { action: 'player.set_volume', payload: { volume: value } };
  }
  return undefined;
}

export function matchMineradioVisualCommand(text: string): { presetId: number } | { random: true } | undefined {
  const normalized = normalizeVisualCommand(text);
  if (['帮我换一个音乐效果', '换一个音乐效果', '换个音乐效果', '随机换个视觉预设', '随机切换视觉预设']
    .some(phrase => normalized.includes(normalizeVisualCommand(phrase)))) return { random: true };

  for (const verb of PRESET_SWITCH_VERBS) {
    const normalizedVerb = normalizeVisualCommand(verb);
    const index = normalized.lastIndexOf(normalizedVerb);
    if (index < 0) continue;
    let target = normalized.slice(index + normalizedVerb.length);
    target = target.replace(/^(?:视觉预设|音乐效果|视觉效果|预设|特效)/, '');
    const aliases = PRESET_ALIASES.flatMap(preset => preset.names.map(name => ({ id: preset.id, name: normalizeVisualCommand(name) })))
      .sort((left, right) => right.name.length - left.name.length);
    const match = aliases.find(alias => alias.name === target);
    if (match) return { presetId: match.id };
  }
  return undefined;
}
