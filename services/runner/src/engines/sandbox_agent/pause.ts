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

  readonly signal: Promise<void>;

  constructor(
    private readonly destroySession: () => Promise<void> | void | undefined,
  ) {
    this.signal = new Promise<void>((resolve) => {
      this.resolvePause = resolve;
    });
  }

  pause(): void {
    if (this.pendingApproval) return;
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
