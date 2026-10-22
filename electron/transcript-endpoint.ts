export type TranscriptEndpointOptions = { silenceMs?: number };

/**
 * Keeps the newest streaming transcript and supplies a client-side endpoint
 * when an ASR service does not send its final/definite marker.
 */
export class TranscriptEndpoint {
  private pending = '';
  private lastActivityAt = -1;
  private readonly silenceMs: number;

  constructor(options: TranscriptEndpointOptions = {}) {
    this.silenceMs = Math.max(250, options.silenceMs ?? 700);
  }

  accept(text: string, final: boolean, now = Date.now()): string | undefined {
    const normalized = text.trim();
    if (!normalized) return undefined;
    this.pending = normalized;
    this.lastActivityAt = now;
    if (!final) return undefined;
    return this.take();
  }

  onAudio(hasVoice: boolean, now = Date.now()): string | undefined {
    if (hasVoice) {
      this.lastActivityAt = now;
      return undefined;
    }
    if (!this.pending || this.lastActivityAt < 0 || now - this.lastActivityAt < this.silenceMs) return undefined;
    return this.take();
  }

  reset() {
    this.pending = '';
    this.lastActivityAt = -1;
  }

  private take() {
    const text = this.pending;
    this.reset();
    return text;
  }
}
