import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import { classifyHeadDirection, HeadDirectionSmoother, type HeadDirection } from './head-gesture';
import type { Landmark } from './hand-gesture';

type Request = { type: 'init' } | { type: 'frame'; frame: ImageBitmap; timestamp: number } | { type: 'dispose' };
const scope = self as DedicatedWorkerGlobalScope;
let landmarker: FaceLandmarker | undefined;
let headSmoother = new HeadDirectionSmoother();
let disposed = false;

scope.onmessage = async (event: MessageEvent<Request>) => {
  const message = event.data;
  if (message.type === 'dispose') {
    disposed = true;
    landmarker?.close();
    landmarker = undefined;
    headSmoother.reset();
    return;
  }
  if (message.type === 'init') {
    try {
      const wasm = new URL('../mediapipe/wasm/', import.meta.url).href;
      const model = new URL('../models/face_landmarker.task', import.meta.url).href;
      const files = await FilesetResolver.forVisionTasks(wasm, true);
      if (disposed) return;
      landmarker = await FaceLandmarker.createFromOptions(files, {
        baseOptions: { modelAssetPath: model, delegate: 'GPU' },
        runningMode: 'VIDEO', numFaces: 1,
      });
      headSmoother.reset();
      if (!disposed) scope.postMessage({ type: 'ready' });
    } catch (error) {
      scope.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) });
    }
    return;
  }
  try {
    if (!landmarker || disposed) return;
    const result = landmarker.detectForVideo(message.frame, message.timestamp);
    const rawDirection: HeadDirection | undefined = result.faceLandmarks[0]
      ? classifyHeadDirection(result.faceLandmarks[0] as Landmark[], false)
      : undefined;
    const headDirection = headSmoother.update(rawDirection, message.timestamp);
    scope.postMessage({ type: 'head', headDirection, timestamp: message.timestamp });
  } catch (error) {
    scope.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  } finally { message.frame.close(); }
};
