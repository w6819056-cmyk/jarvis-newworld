import { gunzip } from 'node:zlib';
import { promisify } from 'node:util';

const gunzipAsync = promisify(gunzip);

export type DoubaoFrame = { header: Buffer; payload: Buffer; json?: any };
export type DoubaoTtsFrame = { header: Buffer; event?: number; sessionId?: string; payload: Buffer; json?: any };

function frame(header: Buffer, payload: Buffer) {
  const size = Buffer.allocUnsafe(4);
  size.writeUInt32BE(payload.length, 0);
  return Buffer.concat([header, size, payload]);
}

function u32(value: number) { const out = Buffer.alloc(4); out.writeUInt32BE(value, 0); return out; }

export async function encodeDoubaoTtsRequest(event: number, sessionId: string | undefined, value: unknown): Promise<Buffer> {
  const payload = Buffer.from(JSON.stringify(value), 'utf8');
  const body = sessionId === undefined
    ? Buffer.concat([u32(event), u32(payload.length), payload])
    : Buffer.concat([u32(event), u32(Buffer.byteLength(sessionId)), Buffer.from(sessionId, 'utf8'), u32(payload.length), payload]);
  // TTS event frames carry their own event/session/payload lengths directly
  // after the header. Unlike ASR V3 frames, they have no outer body length.
  return Buffer.concat([Buffer.from([0x11, 0x14, 0x10, 0x00]), body]);
}

export async function encodeDoubaoJson(value: unknown): Promise<Buffer> {
  // Header 0x10 advertises an uncompressed JSON payload. The V3 service
  // rejects a gzip body when this compression nibble is zero.
  const payload = Buffer.from(JSON.stringify(value), 'utf8');
  return frame(Buffer.from([0x11, 0x10, 0x10, 0x00]), payload);
}

export async function encodeDoubaoAudio(pcm: Buffer): Promise<Buffer> {
  return frame(Buffer.from([0x11, 0x20, 0x00, 0x00]), pcm);
}

export async function decodeDoubaoFrame(input: Buffer): Promise<DoubaoFrame> {
  if (input.length < 8) throw new Error('豆包响应帧过短');
  const header = input.subarray(0, 4);
  const messageType = header[1] >> 4;
  const flags = header[1] & 0x0f;
  // Server response frames may include a sequence number before the payload
  // length. Client request and audio frames do not. Accept both forms because
  // the service can switch between unsequenced and sequenced replies.
  let sizeOffset = 4;
  let size = input.readUInt32BE(sizeOffset);
  if ((messageType === 0x09 || messageType === 0x0f) && flags !== 0 && input.length >= 12) {
    const sequencedSize = input.readUInt32BE(8);
    if (sequencedSize <= input.length - 12) {
      sizeOffset = 8;
      size = sequencedSize;
    }
  }
  if (size > input.length - sizeOffset - 4) throw new Error('豆包响应帧长度无效');
  const payload = input.subarray(sizeOffset + 4, sizeOffset + 4 + size);
  const serialization = header[2] >> 4;
  // The low nibble selects compression: 0 means raw, 1 means gzip.
  const compression = header[2] & 0x0f;
  let data = payload;
  if (compression === 1) data = await gunzipAsync(data);
  if (serialization === 1) {
    try { return { header, payload: data, json: JSON.parse(data.toString('utf8')) }; }
    catch { return { header, payload: data }; }
  }
  return { header, payload: data };
}

export async function decodeDoubaoTtsFrame(input: Buffer): Promise<DoubaoTtsFrame> {
  if (input.length < 8) throw new Error('豆包 TTS 响应帧过短');
  const header = input.subarray(0, 4);
  const type = header[1] >> 4;
  const flags = header[1] & 0x0f;
  let offset = 4;
  let event: number | undefined;
  let sessionId: string | undefined;
  if (type === 0x09 || type === 0x0b) {
    if (flags !== 0x04 || input.length < 12) throw new Error('豆包 TTS 响应事件帧无效');
    event = input.readInt32BE(offset); offset += 4;
    const sessionSize = input.readUInt32BE(offset); offset += 4;
    if (sessionSize > input.length - offset) throw new Error('豆包 TTS session 标识长度无效');
    sessionId = input.subarray(offset, offset + sessionSize).toString('utf8'); offset += sessionSize;
  } else if (type === 0x0f) {
    const errorCode = input.readInt32BE(offset); offset += 4;
    const messageSize = input.readUInt32BE(offset); offset += 4;
    const message = input.subarray(offset, offset + messageSize).toString('utf8');
    throw new Error(`豆包 TTS 错误 ${errorCode}${message ? `：${message}` : ''}`);
  }
  if (input.length < offset + 4) throw new Error('豆包 TTS payload 长度缺失');
  const size = input.readUInt32BE(offset); offset += 4;
  if (size > input.length - offset) throw new Error('豆包 TTS payload 长度无效');
  let payload = input.subarray(offset, offset + size);
  if ((header[2] & 0x0f) === 1) payload = await gunzipAsync(payload);
  const json = (header[2] >> 4) === 1 ? JSON.parse(payload.toString('utf8')) : undefined;
  return { header, event, sessionId, payload, json };
}
