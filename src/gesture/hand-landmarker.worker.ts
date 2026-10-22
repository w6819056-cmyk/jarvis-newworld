import { FilesetResolver, GestureRecognizer } from '@mediapipe/tasks-vision';
import { applyRecognizerPose, classifyGestureHand, type GestureHand, type Landmark } from './hand-gesture';

type Request = { type: 'init' } | { type: 'frame'; frame: ImageBitmap; timestamp: number } | { type: 'dispose' };
const scope = self as DedicatedWorkerGlobalScope;
let landmarker: GestureRecognizer | undefined;
let disposed = false;

scope.onmessage = async (event: MessageEvent<Request>) => {
  const message = event.data;
  if (message.type === 'dispose') {
    disposed = true;
    landmarker?.close();
    landmarker = undefined;
    return;
  }
  if (message.type === 'init') {
    try {
      const wasm = new URL('../mediapipe/wasm/', import.meta.url).href;
      const model = new URL('../models/gesture_recognizer.task', import.meta.url).href;
      const handFiles = await FilesetResolver.forVisionTasks(wasm, true);
      if (disposed) return;
      landmarker = await GestureRecognizer.createFromOptions(handFiles, {
        baseOptions: { modelAssetPath: model, delegate: 'GPU' },
        runningMode: 'VIDEO', numHands: 2, minHandDetectionConfidence: 0.55, minHandPresenceConfidence: 0.55, minTrackingConfidence: 0.55,
      });
      if (!disposed) scope.postMessage({ type: 'ready' });
    } catch (error) {
      scope.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) });
    }
    return;
  }
  try {
    if (!landmarker || disposed) return;
    const result = landmarker.recognizeForVideo(message.frame, message.timestamp);
    const hands: GestureHand[] = result.landmarks.flatMap((points, index) => {
      const category = result.handedness[index]?.[0];
      if (!category) return [];
      const detected = classifyGestureHand(category.categoryName, category.score, points as Landmark[]);
      const poseCategory = result.gestures[index]?.[0];
      applyRecognizerPose(detected, poseCategory?.categoryName, poseCategory?.score ?? 0);
      return [detected];
    });
    scope.postMessage({ type: 'hands', hands, timestamp: message.timestamp });
  } catch (error) {
    scope.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  } finally { message.frame.close(); }
};
