/**
 * Pending-approval pause controller.
 *
 * F-040: an unanswered approval must end the turn, destroy the session, and never reply to the
 * harness gate. Historical docs call this "park"; this module uses pause/pendingApproval names.
 * Terminalization classifies every announced-but-unresolved sibling after managed cancellation
 * drains, so the client never holds an orphaned part or an invented execution result.
 */
export const PAUSED = Symbol("paused");

const EVENT_DRAIN_QUIET_TICKS = 2;
const EVENT_DRAIN_MAX_TICKS = 6;

export class PendingApprovalPauseController {
  private pendingApproval = false;
  private readonly pausedToolCallIds = new Set<string>();
  private readonly allowedExecutionToolCallIds = new Set<string>();
  private readonly answeredDenyToolCallIds = new Set<string>();
  private resolvePause: (() => void) | undefined;
  private gateClassificationVersion = 0;
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
      .then(() => this.waitForGateClassificationQuietPeriod());
    // The turn races this immediate signal; terminalization separately awaits eventDrain so the
    // permission callback never holds the human pause open while queued ACP updates still settle.
    this.resolvePause?.();
  }

  private async waitForGateClassificationQuietPeriod(): Promise<void> {
    let observedVersion = this.gateClassificationVersion;
    let quietTicks = 0;
    for (let tick = 0; tick < EVENT_DRAIN_MAX_TICKS; tick += 1) {
      await new Promise<void>((resolve) => setImmediate(resolve));
      if (observedVersion !== this.gateClassificationVersion) {
        observedVersion = this.gateClassificationVersion;
        quietTicks = 0;
        continue;
      }
      quietTicks += 1;
      if (quietTicks >= EVENT_DRAIN_QUIET_TICKS) return;
    }
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
    const added = !this.pausedToolCallIds.has(toolCallId);
    this.pausedToolCallIds.add(toolCallId);
    // A late gate must extend terminalization long enough for its paused classification to land.
    if (this.pendingApproval && added) this.gateClassificationVersion += 1;
  }

  isPausedToolCall(toolCallId: string | undefined): boolean {
    return toolCallId !== undefined && this.pausedToolCallIds.has(toolCallId);
  }

  /** Record that this turn answered allow for the call, so pause cleanup preserves its result. */
  markAllowedExecution(toolCallId: string): void {
    if (!toolCallId) return;
    this.allowedExecutionToolCallIds.add(toolCallId);
  }

  /** Record an answered deny so its authoritative failed frame survives a sibling pause. */
  markAnsweredDeny(toolCallId: string): void {
    if (!toolCallId) return;
    this.answeredDenyToolCallIds.add(toolCallId);
  }

  isAnsweredDeny(toolCallId: string | undefined): boolean {
    return (
      toolCallId !== undefined &&
      this.answeredDenyToolCallIds.has(toolCallId)
    );
  }

  isAllowedExecution(toolCallId: string | undefined): boolean {
    return (
      toolCallId !== undefined &&
      this.allowedExecutionToolCallIds.has(toolCallId)
    );
  }

  get active(): boolean {
    return this.pendingApproval;
  }
}
