/**
 * Pending-approval pause controller.
 *
 * F-040: an unanswered approval must end the turn, destroy the session, and never reply to the
 * harness gate. Historical docs call this "park"; this module uses pause/pendingApproval names.
 */
export const PAUSED = Symbol("paused");

export class PendingApprovalPauseController {
  private pendingApproval = false;
  private readonly pausedToolCallIds = new Set<string>();
  private resolvePause: (() => void) | undefined;

  readonly signal: Promise<void>;

  constructor(private readonly destroySession: () => Promise<void> | void | undefined) {
    this.signal = new Promise<void>((resolve) => {
      this.resolvePause = resolve;
    });
  }

  pause(): void {
    if (this.pendingApproval) return;
    this.pendingApproval = true;
    this.resolvePause?.();
    void Promise.resolve(this.destroySession()).catch(() => {});
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
