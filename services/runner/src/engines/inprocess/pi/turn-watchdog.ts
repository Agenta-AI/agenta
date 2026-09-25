/**
 * Ends an in-process turn that has gone truly silent, so a stalled model stream or a stuck Pi loop
 * cannot leave the client waiting.
 *
 * Every Pi event is a sign of life: text and thinking deltas, tool-call argument deltas, message
 * starts, compaction and retry events. The clock is suspended while a tool runs (the per-tool-call
 * limit covers that) and while the turn waits for a person to answer a dialog. Two limits apply:
 * a short one when nothing is in flight, and a longer one while a model request, a compaction or
 * a retry back-off is in progress, because a reasoning model may think for minutes without
 * streaming anything.
 */
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";

export interface TurnWatchdogLimits {
  /** Silence allowed between steps, when no model request is in flight. */
  idleMs: number;
  /** Silence allowed while a model request, a compaction or a retry wait is in flight. */
  modelMs: number;
}

export class TurnSilenceError extends Error {
  constructor(silenceMs: number) {
    super(
      `The agent stopped responding: no progress for ${Math.round(silenceMs / 1000)} seconds, so the turn was ended. Send the message again to retry.`,
    );
    this.name = "TurnSilenceError";
  }
}

export class TurnWatchdog {
  private timer: NodeJS.Timeout | undefined;
  private readonly toolsRunning = new Set<string>();
  private dialogsOpen = 0;
  private modelInFlight = false;
  private compacting = false;
  private retrying = false;
  private running = false;

  constructor(
    private readonly limits: TurnWatchdogLimits,
    private readonly onSilence: (error: TurnSilenceError) => void,
  ) {}

  start(): void {
    this.running = true;
    this.toolsRunning.clear();
    this.dialogsOpen = 0;
    this.modelInFlight = this.compacting = this.retrying = false;
    this.arm();
  }

  stop(): void {
    this.running = false;
    this.clear();
  }

  dialogOpened(): void {
    this.dialogsOpen += 1;
    this.arm();
  }

  dialogClosed(): void {
    this.dialogsOpen = Math.max(0, this.dialogsOpen - 1);
    this.arm();
  }

  observe(event: AgentSessionEvent): void {
    switch (event.type) {
      case "message_start":
        if (event.message.role === "assistant") this.modelInFlight = true;
        break;
      case "message_end":
        if (event.message.role === "assistant") this.modelInFlight = false;
        break;
      case "tool_execution_start":
        this.toolsRunning.add(event.toolCallId);
        break;
      case "tool_execution_end":
        this.toolsRunning.delete(event.toolCallId);
        break;
      case "compaction_start":
        this.compacting = true;
        break;
      case "compaction_end":
        this.compacting = false;
        break;
      case "auto_retry_start":
        this.retrying = true;
        break;
      case "auto_retry_end":
        this.retrying = false;
        break;
      default:
        break;
    }
    this.arm();
  }

  private clear(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  private arm(): void {
    this.clear();
    if (!this.running || this.toolsRunning.size > 0 || this.dialogsOpen > 0) return;
    const limit = this.modelInFlight || this.compacting || this.retrying ? this.limits.modelMs : this.limits.idleMs;
    this.timer = setTimeout(() => {
      this.running = false;
      this.onSilence(new TurnSilenceError(limit));
    }, limit);
    this.timer.unref?.();
  }
}
