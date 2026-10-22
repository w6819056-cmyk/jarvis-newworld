import type { ConversationStore } from './conversation-store';

type Pending = { turnId: number; threadId: string };
type UserTurn = { text: string; threadId: string; workspace: string; source: 'typed' | 'voice'; timestamp: number };

export class ConversationArchive {
  private pending = new Map<string, Pending[]>();
  private sequence = 0;

  constructor(private readonly store: ConversationStore) {}

  beginUser(input: UserTurn): number {
    const eventKey = `${input.source}:${input.threadId}:${input.timestamp}:${++this.sequence}`;
    const result = this.store.beginTurn({ eventKey, userText: input.text, timestamp: input.timestamp, threadId: input.threadId, workspace: input.workspace });
    const queue = this.pending.get(input.threadId) ?? [];
    queue.push({ turnId: result.turnId, threadId: input.threadId });
    this.pending.set(input.threadId, queue);
    return result.turnId;
  }

  completeAssistant(threadId: string, text: string, completedAt: number): boolean {
    const queue = this.pending.get(threadId);
    const pending = queue?.[0];
    if (!queue || !pending) return false;
    this.store.completeTurn(pending.turnId, text, completedAt);
    queue.shift();
    if (!queue.length) this.pending.delete(threadId);
    return true;
  }

  failPending(threadId: string): boolean {
    const queue = this.pending.get(threadId);
    if (!queue?.length) return false;
    queue.shift();
    if (!queue.length) this.pending.delete(threadId);
    return true;
  }
}
