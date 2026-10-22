import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { WindowsSpeech } from '../electron/windows-speech.ts';
class Child extends EventEmitter {
  stdin = new PassThrough(); stdout = new PassThrough(); stderr = new PassThrough(); killed = false;
  kill() { this.killed = true; this.emit('exit', 1); return true; }
}
test('speech sends text as stdin data and never interpolates it into executable arguments', async () => {
  const child = new Child(); let args: readonly string[] = [];
  const speech = new WindowsSpeech({ spawnProcess: (_exe: any, passed: any) => { args = passed; return child as never; } });
  const text = '你好 $(Get-Date) ` "';
  let input = ''; child.stdin.on('data', b => input += b.toString());
  const playing = speech.speak(text);
  assert.equal(args.join(' ').includes(text), false);
  assert.deepEqual(JSON.parse(input), { text });
  child.emit('exit', 0); await playing;
});
test('stop terminates speech and resolves the cancelled playback', async () => {
  const child = new Child();
  const speech = new WindowsSpeech({ spawnProcess: () => child as never });
  const playing = speech.speak('停止测试'); speech.stop();
  await playing; assert.equal(child.killed, true);
});
test('a native speech failure is surfaced instead of reporting successful playback', async () => {
  const child = new Child();
  const speech = new WindowsSpeech({ spawnProcess: () => child as never });
  const playing = speech.speak('测试'); child.emit('exit', 2);
  await assert.rejects(playing, /中文语音/);
});
