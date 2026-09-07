/**
 * Recognise a provider answer that says THIS SANDBOX no longer exists.
 *
 * A local sandbox announces its death by refusing the socket: the probe's `fetch` rejects and the
 * liveness counter climbs. A REMOTE sandbox never does that. Daytona keeps its proxy host alive
 * after the sandbox is deleted and answers every request for it with a normal HTTP error that
 * names the sandbox:
 *
 *   404, `x-daytona-error-code: SANDBOX_NOT_FOUND`,
 *   "not found: sandbox <id> not found, it may have been deleted or stopped"
 *
 * The liveness probe reads any HTTP status as alive on purpose (see `sandbox-liveness.ts`), so
 * that answer used to mean "still there" and the turn hung until the runner process died. That is
 * the blind spot this module closes. The answer is authoritative in a way a status alone is not:
 * the provider's own control plane is telling us the machine is gone, so it counts as death on
 * the FIRST sighting rather than after the usual three failures.
 *
 * Recognition is deliberately narrow, because a false positive ends a healthy turn:
 *  - The answer must be an HTTP ERROR (>= 400). A 200 body that merely quotes this prose, such as
 *    an agent describing its own earlier failure, is not evidence of anything.
 *  - Either the provider's own error-code header names the sandbox, or the error body does. A
 *    bare 404 stays "alive": the daemon's health route may simply not exist on an older image,
 *    and reading that as death would end healthy turns.
 */

/** The shape both the probe's `fetch` and the ACP transport's response satisfy. */
export interface SandboxAnswer {
  status: number;
  headers: { get(name: string): string | null };
}

/** Provider headers that carry a machine-readable error code for the sandbox itself. */
const GONE_CODE_HEADERS = ["x-daytona-error-code"] as const;

/**
 * Error codes that mean the sandbox is GONE, not that the request was bad and not that the sandbox
 * is merely between states.
 *
 * `SANDBOX_STOPPED` and `SANDBOX_ARCHIVED` are deliberately absent. Both are RESUMABLE states the
 * provider itself handles, and the reconnect ladder can legitimately meet either one while it
 * brings a parked sandbox back. Reading them as death would end a turn on a sandbox that is about
 * to answer.
 */
const GONE_CODE = /^SANDBOX_(NOT_FOUND|DELETED|DESTROYED)$/i;

/**
 * The same verdict in prose, for a proxy that sends no code header. "may have been deleted or
 * stopped" is Daytona's own wording for a sandbox it cannot find, so it stays even though a
 * `SANDBOX_STOPPED` code does not count.
 */
const GONE_BODY =
  /sandbox\s+\S+\s+not found|may have been deleted or stopped|sandbox\s+\S+\s+(?:has been |was )?(?:deleted|destroyed)/i;

/**
 * The reason this answer proves the sandbox is gone, or undefined when it proves nothing.
 *
 * `bodyText` is optional: the ACP transport must not drain the response body it is about to hand
 * to its caller, so it passes headers only. The liveness probe owns its response and passes the
 * body too.
 */
export function sandboxGoneReason(
  response: SandboxAnswer,
  bodyText?: string,
): string | undefined {
  if (response.status < 400) return undefined;
  for (const header of GONE_CODE_HEADERS) {
    const code = response.headers.get(header)?.trim();
    if (code && GONE_CODE.test(code)) {
      return `provider reports the sandbox is gone (HTTP ${response.status}, ${header}: ${code})`;
    }
  }
  if (bodyText && GONE_BODY.test(bodyText)) {
    return `provider reports the sandbox is gone (HTTP ${response.status}: ${bodyText.slice(0, 200)})`;
  }
  return undefined;
}

/**
 * A one-way latch shared by everything that talks to one sandbox.
 *
 * The ACP transport sees the death first — it is the socket carrying the turn — but it has no way
 * to end a turn. The liveness probe can end a turn but only wakes every 30 seconds. The latch is
 * the seam between them: the transport notes the reason, the probe fires on it at once. First
 * reason wins; later notes are ignored, so one death yields one outcome.
 */
export interface SandboxGoneLatch {
  /**
   * Open the latch. Every `note` before this is DISCARDED.
   *
   * The latch starts closed because the same fetch that carries a turn also carries the SDK's
   * health wait during acquire, and that wait polls a sandbox which is still coming up. A
   * provider proxy that lags its own control plane can answer "not found" for a sandbox it has
   * not finished re-exposing, which is a normal step of a warm resume rather than a death. The
   * latch is one-way, so a report from that window has to be discarded rather than reasoned about
   * later. The owner of the environment arms it once the sandbox is acquired.
   */
  arm(): void;
  /**
   * Record that the sandbox is gone. Idempotent; only the first reason after `arm()` is kept, and
   * a note before `arm()` is ignored.
   */
  note(reason: string): void;
  /** The recorded reason, or undefined while the sandbox still answers. */
  reason(): string | undefined;
  /**
   * Call `listener` when the sandbox is declared gone, or immediately when it already was. At
   * most one call per listener.
   *
   * Returns an unsubscribe function the caller MUST call when its turn ends. A warm environment
   * outlives every turn that runs on it, so a turn that leaves its listener behind leaks one dead
   * closure per turn and would end up calling a finished turn's `onGone`.
   */
  subscribe(listener: (reason: string) => void): () => void;
}

export function createSandboxGoneLatch(): SandboxGoneLatch {
  let armed = false;
  let reason: string | undefined;
  const listeners = new Set<(reason: string) => void>();
  return {
    arm(): void {
      armed = true;
    },
    note(next: string): void {
      if (!armed || reason) return;
      reason = next;
      for (const listener of listeners) {
        try {
          listener(next);
        } catch {
          // A listener fault must not stop the others, nor the request that noticed the death.
        }
      }
      listeners.clear();
    },
    reason: () => reason,
    subscribe(listener: (next: string) => void): () => void {
      if (reason) {
        listener(reason);
        return () => {};
      }
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
