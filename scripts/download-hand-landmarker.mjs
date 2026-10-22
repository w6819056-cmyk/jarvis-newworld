import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const HAND_MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
export const HAND_MODEL_SIZE = 7_819_105;
export const HAND_MODEL_SHA256 = 'fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1';

export function verifyAsset(bytes, expectedSize, expectedSha256) {
  return bytes.byteLength === expectedSize && createHash('sha256').update(bytes).digest('hex') === expectedSha256.toLowerCase();
}

export function verifyHandModel(bytes) {
  return verifyAsset(bytes, HAND_MODEL_SIZE, HAND_MODEL_SHA256);
}

export async function downloadHandModel(destination = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/models/hand_landmarker.task')) {
  await mkdir(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.${process.pid}.tmp`;
  try {
    const response = await fetch(HAND_MODEL_URL);
    if (!response.ok) throw new Error(`Hand Landmarker download failed: HTTP ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!verifyHandModel(bytes)) throw new Error(`Hand Landmarker integrity check failed (expected ${HAND_MODEL_SIZE} bytes, SHA-256 ${HAND_MODEL_SHA256})`);
    await writeFile(temporary, bytes, { flag: 'wx' });
    await rename(temporary, destination);
  } finally {
    await rm(temporary, { force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    await downloadHandModel();
    console.log(`Verified local Hand Landmarker model at public/models/hand_landmarker.task (${HAND_MODEL_SIZE} bytes)`);
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
