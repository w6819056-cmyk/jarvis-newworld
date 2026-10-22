import test from 'node:test';
import assert from 'node:assert/strict';
import { AssemblyAudio, type AssemblyAudioContext } from '../src/helmet/assembly-audio.ts';

class FakeParam {
  events: Array<[string, number, number]> = [];
  setValueAtTime(value: number, time: number) { this.events.push(['set', value, time]); }
  exponentialRampToValueAtTime(value: number, time: number) { this.events.push(['ramp', value, time]); }
}

class FakeNode {
  connections: unknown[] = [];
  connect(destination: unknown) { this.connections.push(destination); }
}

class FakeOscillator extends FakeNode {
  type: OscillatorType = 'sine';
  frequency = new FakeParam();
  startedAt = -1;
  stoppedAt = -1;
  start(time = 0) { this.startedAt = time; }
  stop(time = 0) { this.stoppedAt = time; }
}

class FakeGain extends FakeNode {
  gain = new FakeParam();
}

class FakeAudioContext implements AssemblyAudioContext {
  currentTime = 12;
  state: AudioContextState = 'suspended';
  destination = new FakeNode();
  oscillators: FakeOscillator[] = [];
  gains: FakeGain[] = [];
  async resume() { this.state = 'running'; }
  createOscillator() { const node = new FakeOscillator(); this.oscillators.push(node); return node; }
  createGain() { const node = new FakeGain(); this.gains.push(node); return node; }
}

test('small and large assembly sounds synthesize distinct local tone envelopes', async () => {
  const context = new FakeAudioContext();
  const audio = new AssemblyAudio(() => context);
  await audio.play('small');
  assert.equal(context.oscillators.length, 1);
  assert.equal(context.oscillators[0]?.type, 'triangle');
  assert.equal(context.oscillators[0]?.frequency.events[0]?.[1], 980);
  assert.ok(Math.abs(context.oscillators[0]!.stoppedAt - 12.085) < 1e-9);
  assert.ok(context.gains[0]?.gain.events[1]?.[1]! < 0.05);

  await audio.play('large');
  assert.equal(context.oscillators.length, 4);
  assert.deepEqual(context.oscillators.slice(1).map(node => node.frequency.events[0]?.[1]), [392, 587, 784]);
  assert.ok(context.oscillators[1]!.stoppedAt - context.oscillators[0]!.startedAt > 0.3);
  assert.ok(context.gains.slice(1).some(gain => gain.gain.events[1]![1] > context.gains[0]!.gain.events[1]![1]!));
});

test('audio initialization failures do not escape the optional playback service', async () => {
  const audio = new AssemblyAudio(() => { throw new Error('audio unavailable'); });
  await audio.unlock();
  await audio.play('large');
});
