import { parentPort, workerData } from 'node:worker_threads';
import path from 'node:path';
import { createRequire } from 'node:module';
const loadModule = createRequire(__filename);
try {
  const sherpa = loadModule('sherpa-onnx-node');
  const root = workerData.modelPath as string;
  const recognizer = new sherpa.OnlineRecognizer({
    featConfig: { sampleRate: 16000, featureDim: 80 },
    modelConfig: {
      transducer: { encoder: path.join(root, 'encoder.int8.onnx'), decoder: path.join(root, 'decoder.onnx'), joiner: path.join(root, 'joiner.int8.onnx') },
      tokens: path.join(root, 'tokens.txt'), numThreads: 2, provider: 'cpu', debug: 0,
    },
    decodingMethod: 'greedy_search', enableEndpoint: true,
    rule1MinTrailingSilence: 2.4, rule2MinTrailingSilence: 0.9, rule3MinUtteranceLength: 20,
  });
  let stream = recognizer.createStream();
  let last = '';
  parentPort!.on('message', message => {
    if (message.type === 'reset') { stream = recognizer.createStream(); last = ''; return; }
    if (message.type !== 'audio') return;
    try {
      stream.acceptWaveform({ sampleRate: 16000, samples: message.samples });
      while (recognizer.isReady(stream)) recognizer.decode(stream);
      const text = recognizer.getResult(stream).text.trim();
      const final = recognizer.isEndpoint(stream);
      if (text !== last || final) parentPort!.postMessage({ type: 'result', text, final, epoch: message.epoch });
      last = text;
      if (final) { recognizer.reset(stream); last = ''; }
    } catch (error) { parentPort!.postMessage({ type: 'error', message: String(error) }); }
    finally { parentPort!.postMessage({ type: 'ack' }); }
  });
  parentPort!.postMessage({ type: 'ready' });
} catch (error) { parentPort!.postMessage({ type: 'error', message: String(error) }); }
