export const MINERADIO_PROTOCOL_VERSION = 1;
export const MINERADIO_PIPE_PREFIX = 'mineradio-jarvis';
export const MINERADIO_MAX_FRAME_BYTES = 1024 * 1024;
export const MINERADIO_REQUEST_TIMEOUT_MS = 12_000;
export const MINERADIO_VISUAL_PRESET_COUNT = 13;

export const MINERADIO_ACTIONS = [
  'app.focus', 'player.get_state', 'player.play', 'player.pause', 'player.resume',
  'player.next', 'player.previous', 'player.set_volume', 'search.play', 'visual.set_preset',
] as const;
export type MineradioAction = typeof MINERADIO_ACTIONS[number];
export type MineradioRequest = { version: 1; type: 'request'; id: string; action: MineradioAction; payload: Record<string, unknown> };
export type MineradioResponse = { version: 1; type: 'response'; id: string; ok: boolean; result?: Record<string, unknown>; error?: { code: string; message: string } };

export function encodeFrame(value: unknown) {
  const line = JSON.stringify(value);
  if (Buffer.byteLength(line, 'utf8') > MINERADIO_MAX_FRAME_BYTES) throw new Error('MINERADIO_FRAME_TOO_LARGE');
  return `${line}\n`;
}

export function decodeFrame(line: string) {
  if (Buffer.byteLength(line, 'utf8') > MINERADIO_MAX_FRAME_BYTES) throw new Error('MINERADIO_FRAME_TOO_LARGE');
  return JSON.parse(line);
}

export function validateRequest(value: unknown): MineradioRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_REQUEST');
  const request = value as Record<string, unknown>;
  if (request.version !== MINERADIO_PROTOCOL_VERSION || request.type !== 'request' ||
      typeof request.id !== 'string' || !request.id || request.id.length > 80 ||
      typeof request.action !== 'string' || !MINERADIO_ACTIONS.includes(request.action as MineradioAction) ||
      !request.payload || typeof request.payload !== 'object' || Array.isArray(request.payload)) throw new Error('INVALID_REQUEST');
  const payload = request.payload as Record<string, unknown>;
  switch (request.action) {
    case 'player.set_volume':
      if (!Number.isInteger(payload.volume) || (payload.volume as number) < 0 || (payload.volume as number) > 100) throw new Error('INVALID_VOLUME');
      break;
    case 'search.play':
      if (typeof payload.query !== 'string' || !payload.query.trim() || payload.query.length > 200 ||
          (payload.provider !== undefined && !['netease', 'qq', 'kugou', 'qishui'].includes(String(payload.provider)))) throw new Error('INVALID_SEARCH');
      break;
    case 'visual.set_preset': {
      const keys = Object.keys(payload);
      const named = keys.length === 1 && keys[0] === 'presetId' && Number.isInteger(payload.presetId) &&
        (payload.presetId as number) >= 0 && (payload.presetId as number) < MINERADIO_VISUAL_PRESET_COUNT;
      const random = keys.length === 1 && keys[0] === 'random' && payload.random === true;
      if (!named && !random) throw new Error('INVALID_PRESET');
      break;
    }
  }
  return request as unknown as MineradioRequest;
}
