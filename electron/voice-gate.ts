// Local transcript gate. No audio or wake-listening transcripts are persisted.
// 海/拜/派 were observed for “嗨” through the Windows capture pipeline.
// Keep the assistant name mandatory so an ordinary greeting cannot wake it.
const GAP = '[\\s\\p{P}\\p{Z}]*';
const WAKE_PREFIX = new RegExp(`^\\s*(?:(?:嗨|嘿|黑|海|拜|派|哈喽|你好|hey|hi)${GAP})?(?:贾${GAP}维斯|嘉${GAP}维斯|加${GAP}维斯|甲${GAP}维斯|佳${GAP}维斯|jarvis)${GAP}`, 'iu');
export function isStopUtterance(text: string) {
  return /^(停止|停下|取消任务|停止任务)[。！!\s]*$/.test(text.replace(WAKE_PREFIX, '').trim());
}
export class VoiceGate {
  private awakeUntil = -1;
  private suspended = false;
  private partialWake = false;
  accept(text: string, final: boolean, now = Date.now()) {
    if (this.suspended) return { wake: false, text: '' };
    const prefix = WAKE_PREFIX;
    const match = text.match(prefix);
    let wake = false;
    if (match && !this.partialWake) { wake = true; this.partialWake = true; this.awakeUntil = now + 30000; }
    const command = now <= this.awakeUntil ? text.replace(prefix, '').trim() : '';
    if (final) { this.partialWake = false; if (command) this.awakeUntil = now + 30000; }
    // Wait for the endpoint: acknowledging a partial would cut off a same-breath command.
    return { wake, text: final ? command : '', ...(final && match && !command ? { acknowledge: true } : {}) };
  }
  suspend() { this.suspended = true; this.partialWake = false; }
  resume(now = Date.now()) { this.suspended = false; this.awakeUntil = now + 30000; }
  reset() { this.suspended = false; this.awakeUntil = -1; this.partialWake = false; }
  get awake() { return !this.suspended && Date.now() <= this.awakeUntil; }
}
