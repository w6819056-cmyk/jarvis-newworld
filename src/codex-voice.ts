export type CodexVoiceEvent = { method?: string; params?: { sdp?: unknown } };
export type CodexVoiceTranscript = { role: 'user' | 'assistant'; threadId: string; text: string };

export function extractCodexVoiceTranscript(event: unknown): CodexVoiceTranscript | undefined {
  if (!event || typeof event !== 'object') return undefined;
  const message = event as { method?: unknown; params?: unknown };
  if (message.method !== 'thread/realtime/transcript/done' || !message.params || typeof message.params !== 'object') return undefined;
  const params = message.params as { role?: unknown; threadId?: unknown; text?: unknown };
  if ((params.role !== 'user' && params.role !== 'assistant') || typeof params.threadId !== 'string' || !params.threadId.trim() || typeof params.text !== 'string') return undefined;
  const text = params.text.trim();
  if (!text || text.length > 20000) return undefined;
  return { role: params.role, threadId: params.threadId, text };
}

export function extractCodexSdpAnswer(event: CodexVoiceEvent): string | undefined {
  if (event.method !== 'thread/realtime/sdp' || typeof event.params?.sdp !== 'string') return undefined;
  return event.params.sdp.startsWith('v=0') ? event.params.sdp : undefined;
}

export async function waitForIceGathering(connection: RTCPeerConnection, timeoutMs = 12000): Promise<void> {
  if (connection.iceGatheringState === 'complete') return;
  await new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      connection.removeEventListener('icegatheringstatechange', changed);
      reject(new Error('WebRTC ICE gathering timed out'));
    }, timeoutMs);
    const changed = () => {
      if (connection.iceGatheringState !== 'complete') return;
      window.clearTimeout(timer);
      connection.removeEventListener('icegatheringstatechange', changed);
      resolve();
    };
    connection.addEventListener('icegatheringstatechange', changed);
  });
}
