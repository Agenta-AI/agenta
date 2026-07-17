/**
 * Pending-approval pause controller.
 *
 * F-040: an unanswered approval must end the turn, destroy the session, and never reply to the
 * harness gate. Historical docs call this "park"; this module uses pause/pendingApproval names.
 * The destroy callback also settles every announced-but-unresolved sibling tool call with a
 * deterministic `tool_result` before teardown, so the client never holds an orphaned part.
 */
export const PAUSED = Symbol("paused");

export class PendingApprovalPauseController {
  private pendingApproval = false;
  private readonly pausedToolCallIds = new Set<string>();
  private resolvePause: (() => void) | undefined;
  private eventDrain: Promise<void> = Promise.resolve();
  private pauseTimer: ReturnType<typeof setTimeout> | undefined;

  readonly signal: Promise<void>;

  constructor(
    private readonly destroySession: () => Promise<void> | void | undefined,
  ) {
    this.signal = new Promise<void>((resolve) => {
      this.resolvePause = resolve;
    });
  }

  /**
   * Debounced pause: (re)arm a timer so the turn pauses only once the harness has been quiet for
   * `delayMs`. Parallel approval gates arrive staggered (~0.5s apart, measured), so pausing on the
   * FIRST would strand the rest; each incoming gate calls this again to extend the window, and the
   * turn parks once with the whole batch. A late gate that lands after the timer fires falls back to
   * the straggler path (force-settled → cold retry), exactly as a non-collected gate does today.
   * `pause()` (client tool, non-parkable, teardown) still ends the turn immediately.
   */
  schedulePause(delayMs: number): void {
    if (this.pendingApproval) return; // already paused; the batch is closed
    // No collection window: pause on this gate immediately (synchronous), i.e. today's
    // one-gate-per-turn behavior. Also the deterministic path for tests.
    if (delayMs <= 0) {
      this.pause();
      return;
    }
    if (this.pauseTimer) clearTimeout(this.pauseTimer);
    this.pauseTimer = setTimeout(() => {
      this.pauseTimer = undefined;
      this.pause();
    }, delayMs);
    // Do not keep the event loop alive solely for the collection window.
    this.pauseTimer.unref?.();
  }

  /**
   * Cancel any armed collect-window timer without pausing. Turn-scoped, like `runLimits.dispose()`:
   * `run-turn.ts` calls it in `finally` so a timer this turn armed can never fire against the pooled
   * `env` after the turn exited some other way (run-limit trip, throw). No-op once `pause()` ran.
   */
  dispose(): void {
    if (this.pauseTimer) {
      clearTimeout(this.pauseTimer);
      this.pauseTimer = undefined;
    }
  }

  pause(): void {
    if (this.pendingApproval) return;
    if (this.pauseTimer) {
      clearTimeout(this.pauseTimer);
      this.pauseTimer = undefined;
    }
    this.pendingApproval = true;
    let destroyResult: Promise<void> | void | undefined;
    try {
      destroyResult = this.destroySession();
    } catch {
      destroyResult = undefined;
    }
    this.eventDrain = Promise.resolve(destroyResult)
      .catch(() => {})
      .then(() => new Promise<void>((resolve) => setImmediate(resolve)));
    // The turn races this immediate signal; terminalization separately awaits eventDrain so the
    // permission callback never holds the human pause open while queued ACP updates still settle.
    this.resolvePause?.();
  }

  /** Wait until managed cancellation and already-queued ACP updates have drained. */
  waitForEventDrain(): Promise<void> {
    return this.eventDrain;
  }

  /**
   * F-024 lineage: once a paused tool call emits its `interaction_request`, that request is the
   * last word for the call this turn. Later harness frames for the same id are teardown artifacts
   * from cancellation/session disposal and must not reach the event stream.
   */
  markPausedToolCall(toolCallId: string): void {
    if (!toolCallId) return;
    this.pausedToolCallIds.add(toolCallId);
  }

  isPausedToolCall(toolCallId: string | undefined): boolean {
    return toolCallId !== undefined && this.pausedToolCallIds.has(toolCallId);
  }

  get active(): boolean {
    return this.pendingApproval;
  }
}
