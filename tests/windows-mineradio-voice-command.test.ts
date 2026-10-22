import assert from 'node:assert/strict';
import test from 'node:test';
import { matchMineradioDirectCommand, matchMineradioVisualCommand, shouldOpenMineradioFromTranscript } from '../electron/mineradio-voice-command.ts';

test('opens Mineradio only when the complete final utterance is the designated phrase', () => {
  assert.equal(shouldOpenMineradioFromTranscript('咱们开启音乐播放器', true), true);
  assert.equal(shouldOpenMineradioFromTranscript('咱们，开启 音乐播放器！', true), true);
  assert.equal(shouldOpenMineradioFromTranscript('请咱们开启音乐播放器', true), false);
  assert.equal(shouldOpenMineradioFromTranscript('咱们开启音乐播放器然后搜索周杰伦', true), false);
  assert.equal(shouldOpenMineradioFromTranscript('咱们开起音乐播放器', true), false);
  assert.equal(shouldOpenMineradioFromTranscript('打开音乐播放器', true), false);
  assert.equal(shouldOpenMineradioFromTranscript('咱们开启音乐播放器', false), false);
});

test('maps explicit voice requests to all built-in Mineradio visual presets', () => {
  const cases = [
    ['切换到Emily专辑封面', 0], ['切到滚筒', 1], ['换成星球', 2], ['设置为虚空', 3],
    ['切换到唱片', 4], ['换成星河', 5], ['切到安魂', 6], ['切换到音域回响', 7],
    ['切换到音域回响 Wallpaper Engine', 8], ['切换到月蚀圣环', 9], ['换成雨幕霓虹', 10],
    ['切到折光蝶群', 11], ['切换为深海绽放', 12],
  ] as const;
  for (const [utterance, presetId] of cases) assert.deepEqual(matchMineradioVisualCommand(utterance), { presetId }, utterance);
});

test('random visual request changes preset without passing an incidental preset mention', () => {
  assert.deepEqual(matchMineradioVisualCommand('帮我换一个音乐效果'), { random: true });
  assert.deepEqual(matchMineradioVisualCommand('随机换个视觉预设'), { random: true });
  assert.equal(matchMineradioVisualCommand('播放雨幕霓虹这首歌'), undefined);
  assert.equal(matchMineradioVisualCommand('我喜欢月蚀圣环'), undefined);
  assert.equal(matchMineradioVisualCommand('把音乐效果切回月蚀圣环'), undefined);
});

test('routes unambiguous playback commands directly to the local Mineradio bridge', () => {
  assert.deepEqual(matchMineradioDirectCommand('暂停音乐'), { action: 'player.pause', payload: {} });
  assert.deepEqual(matchMineradioDirectCommand('继续播放'), { action: 'player.resume', payload: {} });
  assert.deepEqual(matchMineradioDirectCommand('下一首'), { action: 'player.next', payload: {} });
  assert.deepEqual(matchMineradioDirectCommand('上一首歌'), { action: 'player.previous', payload: {} });
  assert.deepEqual(matchMineradioDirectCommand('现在放的是什么'), { action: 'player.get_state', payload: {} });
  assert.deepEqual(matchMineradioDirectCommand('音量调到 30%'), { action: 'player.set_volume', payload: { volume: 30 } });
});

test('does not steal task or natural-language requests from Codex', () => {
  assert.equal(matchMineradioDirectCommand('暂停任务'), undefined);
  assert.equal(matchMineradioDirectCommand('帮我搜索下一首适合跑步的歌'), undefined);
  assert.equal(matchMineradioDirectCommand('声音小一点'), undefined);
  assert.equal(matchMineradioDirectCommand('音量调到一半'), undefined);
});
