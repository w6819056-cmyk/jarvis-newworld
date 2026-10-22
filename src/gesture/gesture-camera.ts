import type { GestureHand } from './hand-gesture';
import type { HeadDirection } from './head-gesture';

export type GestureModeStatus = 'off' | 'requesting' | 'tracking' | 'error';
type HandsCallback = (hands: readonly GestureHand[], nowMs: number, headDirection?: HeadDirection) => void;
type CameraWorkerMessage = { type: 'ready' } | { type: 'hands'; hands: GestureHand[]; headDirection?: HeadDirection; timestamp: number } | { type: 'error'; message: string };
type FaceWorkerMessage = { type: 'ready' } | { type: 'head'; headDirection?: HeadDirection; timestamp: number } | { type: 'error'; message: string };

export interface GesturePreviewFrame {
  video?: HTMLVideoElement;
  hands: readonly GestureHand[];
  headDirection?: HeadDirection;
}

interface GestureCameraDependencies {
  mediaDevices?: Pick<MediaDevices, 'getUserMedia'>;
  createVideoElement?: () => HTMLVideoElement;
  createWorker?: () => Worker;
  createFaceWorker?: () => Worker;
  createImageBitmap?: (image: ImageBitmapSource) => Promise<ImageBitmap>;
  setInterval?: (handler: () => void, timeout: number) => ReturnType<typeof globalThis.setInterval>;
  clearInterval?: (handle: ReturnType<typeof globalThis.setInterval>) => void;
  onStatus?: (status: GestureModeStatus, message?: string) => void;
}

export class GestureCamera {
  private readonly mediaDevices: Pick<MediaDevices, 'getUserMedia'>;
  private readonly createVideoElement: () => HTMLVideoElement;
  private readonly createWorker: () => Worker;
  private readonly createFaceWorker: () => Worker;
  private readonly faceEnabled: boolean;
  private readonly createImageBitmap: (image: ImageBitmapSource) => Promise<ImageBitmap>;
  private readonly schedule: NonNullable<GestureCameraDependencies['setInterval']>;
  private readonly cancelSchedule: NonNullable<GestureCameraDependencies['clearInterval']>;
  private readonly onStatus: (status: GestureModeStatus, message?: string) => void;
  private stream: MediaStream | undefined;
  private video: HTMLVideoElement | undefined;
  private worker: Worker | undefined;
  private faceWorker: Worker | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;
  private callback: HandsCallback | undefined;
  private previewCallback: ((frame: GesturePreviewFrame) => void) | undefined;
  private pendingFrame = false;
  private pendingFaceFrame = false;
  private handReady = false;
  private faceReady = false;
  private headDirection: HeadDirection | undefined;
  private lastHands: GestureHand[] = [];
  private stopped = true;
  private startPromise: Promise<void> | undefined;

  constructor(deps: GestureCameraDependencies = {}) {
    this.mediaDevices = deps.mediaDevices ?? navigator.mediaDevices;
    this.createVideoElement = deps.createVideoElement ?? (() => document.createElement('video'));
    this.createWorker = deps.createWorker ?? (() => new Worker(new URL('./hand-landmarker.worker.ts', import.meta.url), { type: 'module' }));
    this.faceEnabled = deps.createFaceWorker !== undefined || typeof Worker !== 'undefined';
    this.createFaceWorker = deps.createFaceWorker ?? (() => new Worker(new URL('./face-landmarker.worker.ts', import.meta.url), { type: 'module' }));
    this.createImageBitmap = deps.createImageBitmap ?? (image => globalThis.createImageBitmap(image));
    this.schedule = deps.setInterval ?? ((handler, timeout) => globalThis.setInterval(handler, timeout));
    this.cancelSchedule = deps.clearInterval ?? (handle => globalThis.clearInterval(handle));
    this.onStatus = deps.onStatus ?? (() => {});
  }

  start(onHands: HandsCallback, onPreview?: (frame: GesturePreviewFrame) => void): Promise<void> {
    if (this.startPromise) return this.startPromise;
    if (!this.stopped) return Promise.resolve();
    this.stopped = false;
    this.callback = onHands;
    this.previewCallback = onPreview;
    this.onStatus('requesting');
    this.startPromise = this.startCapture();
    return this.startPromise;
  }

  private async startCapture(): Promise<void> {
    try {
      const stream = await this.mediaDevices.getUserMedia({ audio: false, video: { width: 640, height: 480 } });
      if (this.stopped) { stream.getTracks().forEach(track => track.stop()); return; }
      this.stream = stream;
      const video = this.createVideoElement();
      this.video = video;
      video.muted = true;
      video.playsInline = true;
      video.style.position = 'fixed';
      video.style.width = '1px';
      video.style.height = '1px';
      video.style.opacity = '0';
      video.style.pointerEvents = 'none';
      video.srcObject = stream;
      await video.play();
      if (this.stopped) return;
      this.publishPreview();
      for (const track of stream.getVideoTracks()) track.addEventListener('ended', this.onTrackEnded, { once: true });
      const worker = this.createWorker();
      this.worker = worker;
      worker.onmessage = event => this.handleWorkerMessage(event.data as CameraWorkerMessage);
      worker.onerror = event => this.fail(event.message || '本地手势识别器启动失败');
      worker.postMessage({ type: 'init' });
      if (this.faceEnabled) {
        const faceWorker = this.createFaceWorker();
        this.faceWorker = faceWorker;
        faceWorker.onmessage = event => this.handleFaceWorkerMessage(event.data as FaceWorkerMessage);
        faceWorker.onerror = event => this.fail(event.message || '本地头部识别器启动失败');
        faceWorker.postMessage({ type: 'init' });
      }
    } catch (error) {
      this.fail(error instanceof Error ? error.message : String(error));
      throw error;
    } finally {
      this.startPromise = undefined;
    }
  }

  private readonly onTrackEnded = () => this.fail('摄像头已断开，请重新开启手势模式');

  private handleWorkerMessage(message: CameraWorkerMessage): void {
    if (this.stopped) return;
    if (message.type === 'ready') {
      this.handReady = true;
      if (!this.faceEnabled || this.faceReady) this.onStatus('tracking');
      if ((!this.faceEnabled || this.faceReady) && !this.timer) this.timer = this.schedule(() => void this.captureFrame(), 33);
    } else if (message.type === 'hands') {
      this.pendingFrame = false;
      this.lastHands = message.hands;
      this.callback?.(message.hands, message.timestamp, this.headDirection);
      this.publishPreview();
    }
    else this.fail(message.message);
  }

  private handleFaceWorkerMessage(message: FaceWorkerMessage): void {
    if (this.stopped) return;
    if (message.type === 'ready') {
      this.faceReady = true;
      if (this.handReady) this.onStatus('tracking');
      if (this.handReady && !this.timer) this.timer = this.schedule(() => void this.captureFrame(), 33);
    } else if (message.type === 'head') {
      this.pendingFaceFrame = false;
      this.headDirection = message.headDirection;
      this.callback?.(this.lastHands, message.timestamp, this.headDirection);
      this.publishPreview();
    } else this.fail(message.message);
  }

  private async captureFrame(): Promise<void> {
    const video = this.video;
    const worker = this.worker;
    if (this.stopped || this.pendingFrame || this.pendingFaceFrame || !video || !worker || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
    this.pendingFrame = true;
    let handFrame: ImageBitmap | undefined;
    let faceFrame: ImageBitmap | undefined;
    try {
      const timestamp = performance.now();
      handFrame = await this.createImageBitmap(video);
      if (this.stopped) { handFrame.close(); return; }
      worker.postMessage({ type: 'frame', frame: handFrame, timestamp }, [handFrame]);
      if (this.faceWorker) {
        this.pendingFaceFrame = true;
        faceFrame = await this.createImageBitmap(video);
        if (this.stopped) { faceFrame.close(); return; }
        this.faceWorker.postMessage({ type: 'frame', frame: faceFrame, timestamp }, [faceFrame]);
      }
    } catch (error) {
      this.pendingFrame = false;
      this.pendingFaceFrame = false;
      handFrame?.close();
      faceFrame?.close();
      this.fail(error instanceof Error ? error.message : String(error));
    }
  }

  private fail(message: string): void {
    this.stopResources();
    this.onStatus('error', message);
  }

  private publishPreview(video = this.video): void {
    this.previewCallback?.({ video, hands: this.lastHands, headDirection: this.headDirection });
  }

  stop(): void {
    this.stopResources();
    this.onStatus('off');
  }

  private stopResources(): void {
    if (this.stopped) return;
    this.previewCallback?.({ video: undefined, hands: [], headDirection: undefined });
    this.stopped = true;
    if (this.timer) this.cancelSchedule(this.timer);
    this.timer = undefined;
    this.stream?.getTracks().forEach(track => { track.removeEventListener('ended', this.onTrackEnded); track.stop(); });
    this.stream = undefined;
    if (this.video) this.video.srcObject = null;
    this.video = undefined;
    this.worker?.postMessage({ type: 'dispose' });
    this.worker?.terminate();
    this.worker = undefined;
    this.faceWorker?.postMessage({ type: 'dispose' });
    this.faceWorker?.terminate();
    this.faceWorker = undefined;
    this.pendingFrame = false;
    this.pendingFaceFrame = false;
    this.handReady = false;
    this.faceReady = false;
    this.headDirection = undefined;
    this.lastHands = [];
    this.callback = undefined;
    this.previewCallback = undefined;
  }
}
