/**
 * Pending-approval pause controller.
 *
 * F-040: an unanswered approval must end the turn, destroy the session, and never reply to the
 * harness gate. Historical docs call this "park"; this module uses pause/pendingApproval names.
 */
export const PAUSED = Symbol("paused");

export class PendingApprovalPauseController {
  private pendingApproval = false;
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

  get active(): boolean {
    return this.pendingApproval;
  }
}
