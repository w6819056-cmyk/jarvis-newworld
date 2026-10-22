import test from 'node:test';
import assert from 'node:assert/strict';
import { GestureCamera } from '../src/gesture/gesture-camera.ts';

class FakeTrack extends EventTarget {
  stops = 0;
  stop() { this.stops++; }
}
class FakeWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  messages: unknown[] = [];
  terminated = 0;
  postMessage(message: unknown) { this.messages.push(message); }
  terminate() { this.terminated++; }
  send(data: unknown) { this.onmessage?.({ data } as MessageEvent); }
}
function fixture() {
  const track = new FakeTrack();
  const worker = new FakeWorker();
  const video = { muted: false, playsInline: false, readyState: 4, srcObject: null as MediaStream | null, play: async () => {}, style: {} as CSSStyleDeclaration } as HTMLVideoElement;
  const constraints: unknown[] = [];
  const statuses: string[] = [];
  let scheduledCapture: (() => void) | undefined;
  const camera = new GestureCamera({
    mediaDevices: { getUserMedia: async value => { constraints.push(value); return { getTracks: () => [track], getVideoTracks: () => [track] } as unknown as MediaStream; } } as MediaDevices,
    createVideoElement: () => video,
    createWorker: () => worker as unknown as Worker,
    createImageBitmap: async () => ({ close() {} } as ImageBitmap),
    setInterval: (handler => { scheduledCapture = handler; return 1 as unknown as ReturnType<typeof setInterval>; }),
    clearInterval: () => {},
    onStatus: status => statuses.push(status),
  });
  return { camera, track, worker, video, constraints, statuses, tick: () => scheduledCapture?.() };
}

test('requests video only after start and stops every track idempotently', async () => {
  const { camera, track, worker, video, constraints } = fixture();
  await camera.start(() => {});
  assert.deepEqual(constraints, [{ audio: false, video: { width: 640, height: 480 } }]);
  assert.equal(video.muted, true);
  assert.equal(video.playsInline, true);
  assert.equal(video.srcObject !== null, true);
  worker.send({ type: 'ready' });
  camera.stop();
  camera.stop();
  assert.equal(track.stops, 1);
  assert.equal(video.srcObject, null);
  assert.equal(worker.terminated, 1);
});

test('permission denial reports error and leaves capture off', async () => {
  const { camera, statuses } = fixture();
  const failed = new GestureCamera({
    mediaDevices: { getUserMedia: async () => { throw new Error('denied'); } } as unknown as MediaDevices,
    createVideoElement: () => { throw new Error('video must not be created'); },
    createWorker: () => { throw new Error('worker must not be created'); },
    onStatus: status => statuses.push(status),
  });
  await assert.rejects(failed.start(() => {}), /denied/);
  assert.deepEqual(statuses.slice(-2), ['requesting', 'error']);
  camera.stop();
});

test('ended camera track tears down worker and publishes an error', async () => {
  const { camera, track, worker, statuses } = fixture();
  await camera.start(() => {});
  worker.send({ type: 'ready' });
  track.dispatchEvent(new Event('ended'));
  assert.equal(track.stops, 1);
  assert.equal(worker.terminated, 1);
  assert.equal(statuses.at(-1), 'error');
});

test('forwards both handed landmark records from the worker to the gesture callback', async () => {
  const { camera, worker } = fixture();
  const received: unknown[] = [];
  await camera.start(hands => received.push(hands));
  worker.send({ type: 'ready' });
  const hands = [
    { handedness: 'Left', confidence: 0.94, pose: 'open', fingerCount: 4, landmarks: [{ x: 0.2, y: 0.4 }] },
    { handedness: 'Right', confidence: 0.91, pose: 'neutral', fingerCount: 1, landmarks: [{ x: 0.8, y: 0.5 }] },
  ];
  worker.send({ type: 'hands', hands, timestamp: 1234 });
  assert.deepEqual(received, [hands]);
  camera.stop();
});

test('publishes live preview frames with hands and clears them on hand loss and stop', async () => {
  const { camera, worker, video } = fixture();
  const previews: Array<{ video?: HTMLVideoElement; hands: readonly unknown[]; headDirection?: string }> = [];
  await camera.start(() => {}, frame => previews.push(frame));
  worker.send({ type: 'ready' });
  const hands = [{ handedness: 'Right', pose: 'fist', fingerCount: 0, landmarks: [{ x: 0.4, y: 0.6 }] }];
  worker.send({ type: 'hands', hands, timestamp: 10 });
  assert.equal(previews.at(-1)?.video, video);
  assert.deepEqual(previews.at(-1)?.hands, hands);
  worker.send({ type: 'hands', hands: [], timestamp: 20 });
  assert.deepEqual(previews.at(-1)?.hands, []);
  camera.stop();
  assert.deepEqual(previews.at(-1)?.hands, []);
  assert.equal(previews.at(-1)?.video, undefined);
});

test('does not queue another video frame until the worker finishes the current frame', async () => {
  Object.defineProperty(globalThis, 'HTMLMediaElement', { value: { HAVE_CURRENT_DATA: 2 }, configurable: true });
  const { camera, worker, tick } = fixture();
  await camera.start(() => {});
  worker.send({ type: 'ready' });
  tick();
  await new Promise(resolve => setTimeout(resolve, 0));
  tick();
  assert.equal(worker.messages.filter(message => (message as { type: string }).type === 'frame').length, 1);
  worker.send({ type: 'hands', hands: [], timestamp: 1 });
  tick();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(worker.messages.filter(message => (message as { type: string }).type === 'frame').length, 2);
  camera.stop();
});
