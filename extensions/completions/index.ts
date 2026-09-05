import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

export const COMPLETION_READY = "pi-skills:completion-ready";
export const COMPLETION_OBSERVED = "pi-skills:completion-observed";
export interface CompletionNotice {
  sessionId: string;
  key: string;
  content: string;
  wake: boolean;
}
export interface CompletionObservation {
  sessionId: string;
  keys: string[];
}

export class CompletionQueue {
  private readonly pending = new Map<string, CompletionNotice>();
  private readonly observed = new Set<string>();
  constructor(readonly sessionId: string) {}
  get size(): number { return this.pending.size; }

  add(notice: CompletionNotice): void {
    if (notice.sessionId !== this.sessionId || this.observed.has(notice.key)) return;
    this.pending.set(notice.key, notice);
  }

  acknowledge(observation: CompletionObservation): void {
    if (observation.sessionId !== this.sessionId) return;
    for (const key of observation.keys) {
      this.observed.add(key);
      this.pending.delete(key);
    }
  }

  deliver(send: (content: string, wake: boolean) => void): void {
    const batch: CompletionNotice[] = [];
    let content = "Background completions not previously observed:\n";
    for (const notice of this.pending.values()) {
      const item = `\n[${notice.key}]\n${notice.content.slice(0, 4000)}\n`;
      if (batch.length > 0 && content.length + item.length > 24_000) break;
      batch.push(notice);
      content += item;
    }
    if (batch.length === 0) return;
    send(content, batch.some((notice) => notice.wake));
    this.acknowledge({ sessionId: this.sessionId, keys: batch.map((notice) => notice.key) });
  }
}

export default function completionsExtension(pi: ExtensionAPI): void {
  let queue: CompletionQueue | undefined;
  let ctx: ExtensionContext | undefined;
  let timer: NodeJS.Timeout | undefined;
  let waking = false;
  let unsubscribe: Array<() => void> = [];

  function schedule(): void {
    if (timer || !queue?.size || !ctx) return;
    timer = setTimeout(flush, 100);
    timer.unref();
  }

  function flush(): void {
    timer = undefined;
    if (!queue?.size || !ctx) return;
    // Never put per-task followUps into Pi while it is busy. They cannot be
    // retracted after status/wait/logs have already supplied the same result.
    if (!ctx.isIdle() || waking) { schedule(); return; }
    try {
      queue.deliver((content, wake) => {
        waking = wake;
        pi.sendMessage({ customType: "task-completions", content, display: true }, { triggerTurn: wake });
      });
    } catch (error) {
      waking = false;
      console.error("[completions] delivery failed:", error);
    }
    schedule();
  }

  pi.on("session_start", (_event, context) => {
    ctx = context;
    queue = new CompletionQueue(context.sessionManager.getSessionId());
    waking = false;
    unsubscribe = [
      pi.events.on(COMPLETION_READY, (value) => { queue?.add(value as CompletionNotice); schedule(); }),
      pi.events.on(COMPLETION_OBSERVED, (value) => queue?.acknowledge(value as CompletionObservation)),
    ];
  });
  pi.on("agent_start", () => { waking = false; });
  pi.on("agent_end", () => { waking = false; schedule(); });
  pi.on("input", () => { waking = false; });
  pi.on("session_shutdown", () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
    queue = undefined;
    ctx = undefined;
    waking = false;
    for (const off of unsubscribe) off();
    unsubscribe = [];
  });
}
