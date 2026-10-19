import { createHash } from 'node:crypto';
export interface PuckMessage {
  role: string;
  messageId?: number;
  protocolMessageID?: string;
  state?: { type?: string; stopReason?: string };
  meta?: { openAIResponsePhase?: string };
  content?: { type: string; text?: string }[];
}
export interface PuckThread {
  id: string;
  agentMode?: string;
  messages: PuckMessage[];
}
const textOf = (message: PuckMessage) =>
  (message.content || [])
    .filter((c) => c.type === 'text')
    .map((c) => c.text || '')
    .join('\n')
    .trim();
export function puckReplies(thread: PuckThread, marker: string, seen: Set<string>) {
  if (thread.agentMode !== 'puck') throw new Error('The update source is not a Puck conversation.');
  const start = thread.messages.findIndex((m) => m.role === 'user' && textOf(m).includes(marker));
  if (start < 0) throw new Error('Puck conversation could not be matched to this request.');
  const replies: string[] = [];
  for (const message of thread.messages.slice(start + 1)) {
    if (
      message.role !== 'assistant' ||
      message.state?.type !== 'complete' ||
      (message.state.stopReason !== 'end_turn' &&
        message.meta?.openAIResponsePhase !== 'final_answer')
    )
      continue;
    const text = textOf(message);
    if (!text) continue;
    const id =
      message.protocolMessageID ||
      String(message.messageId ?? createHash('sha256').update(text).digest('hex'));
    if (seen.has(id)) continue;
    seen.add(id);
    replies.push(text);
  }
  return replies;
}

export class PuckUpdates {
  private thread?: { id: string; marker: string };
  private seen = new Set<string>();
  private timer?: NodeJS.Timeout;
  private reading = false;
  private generation = 0;
  constructor(
    private reader: {
      findPuck: (marker: string) => Promise<string | undefined>;
      readPuck: (id: string) => Promise<PuckThread>;
    },
    private receive: (text: string, threadId: string) => void,
    private status: (ready: boolean) => void,
  ) {}
  async bind(marker: string): Promise<boolean> {
    const generation = this.generation;
    try {
      const id = await this.reader.findPuck(marker);
      if (!id) throw new Error('No matching Puck conversation');
      const thread = await this.reader.readPuck(id);
      if (generation !== this.generation) return false;
      if (this.thread?.id !== id) {
        this.thread = { id, marker };
        this.seen = new Set();
      }
      this.deliver(thread);
      if (!this.timer) this.timer = setInterval(() => void this.poll(), 10000).unref();
      this.status(true);
      return true;
    } catch {
      if (generation === this.generation) this.status(false);
      return false;
    }
  }
  private deliver(thread: PuckThread) {
    if (!this.thread || this.thread.id !== thread.id) return;
    for (const text of puckReplies(thread, this.thread.marker, this.seen))
      this.receive(text, thread.id);
  }
  async poll() {
    if (this.reading || !this.thread) return;
    this.reading = true;
    const generation = this.generation;
    const threadId = this.thread.id;
    try {
      const thread = await this.reader.readPuck(threadId);
      if (generation !== this.generation || threadId !== this.thread?.id) return;
      this.deliver(thread);
      this.status(true);
    } catch {
      if (generation === this.generation) this.status(false);
    } finally {
      this.reading = false;
    }
  }
  close() {
    this.generation++;
    clearInterval(this.timer);
    this.timer = undefined;
    this.thread = undefined;
    this.seen.clear();
  }
}
