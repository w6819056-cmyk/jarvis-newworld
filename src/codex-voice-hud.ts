import { extractCodexVoiceTranscript } from './codex-voice';
import { HudResults } from './hud-results';

export class CodexVoiceHud {
  private lastFinal?: { threadId: string; text: string };

  constructor(private readonly results: HudResults) {}

  accept(event: unknown): number | undefined {
    const transcript = extractCodexVoiceTranscript(event);
    if (!transcript) return undefined;
    if (transcript.role === 'user') {
      this.lastFinal = undefined;
      return undefined;
    }
    if (this.lastFinal?.threadId === transcript.threadId && this.lastFinal.text === transcript.text) return undefined;
    this.lastFinal = { threadId: transcript.threadId, text: transcript.text };
    const id = this.results.begin();
    this.results.update(id, transcript.text, false);
    return id;
  }
}
