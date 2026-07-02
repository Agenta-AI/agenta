/**
 * E2B idle-refresh keepalive (D3): makes `E2B_TIMEOUT_MS` behave like Daytona's idle-based
 * autostop instead of a hard wall-clock cap on the run.
 *
 * `DEFAULT_E2B_TIMEOUT_MS` (see provider.ts) is a leak backstop: it self-reaps a sandbox a
 * process KILL orphaned (the per-run `finally` never ran to call `destroySandbox`). But E2B
 * enforces that timeout as an absolute deadline from sandbox creation — with no refresh, a
 * legitimately long-running turn (a big agent loop, a parked HITL wait) is killed mid-run at
 * the cap, unlike Daytona's `autoStopInterval`, which measures IDLE time and never fires while
 * the sandbox is busy (see `daytonaAutoStopMinutes` in provider.ts).
 *
 * The E2B SDK supports extending a live sandbox's timeout: `Sandbox.setTimeout(sandboxId,
 * timeoutMs)` (a static method on `@e2b/code-interpreter`, which is a direct dependency of this
 * package — see package.json — not just a transitive dependency of the `sandbox-agent` wrapper).
 * This is the affordance the runner needs. It is reachable from here even though the
 * `sandbox-agent` SDK's own `SandboxAgent.sandbox` getter does NOT expose it: that getter
 * returns the `SandboxProvider` wrapper interface (`{name, create, destroy, pause, kill,
 * getUrl, ensureServer}`; see `node_modules/sandbox-agent/dist/types-DdcvY5CI.d.ts`), which has
 * no extend-timeout method, and the real E2B `Sandbox` instance the `sandbox-agent/e2b`
 * provider connects to is a private local inside that module's closures — never handed back to
 * the caller. So the keepalive calls `Sandbox.setTimeout` directly against the sandbox ID
 * (`SandboxAgent.sandboxId`), independent of the `sandbox-agent` wrapper.
 *
 * Semantics once wired: `E2B_TIMEOUT_MS` becomes "time since last liveness proof", exactly like
 * Daytona's autostop. A live run refreshes the deadline every `timeoutMs / 3` (comfortably
 * inside the window even under scheduling jitter); a killed runner stops refreshing and the
 * sandbox self-reaps within `timeoutMs` of the kill, preserving the original leak-backstop
 * guarantee.
 */

import { Sandbox } from "@e2b/code-interpreter";

type Log = (message: string) => void;

/** Minimum viable refresh interval so a tiny configured timeout cannot busy-loop. */
const MIN_REFRESH_INTERVAL_MS = 1000;

/** How often to refresh, as a fraction of the timeout: comfortably inside the deadline. */
const REFRESH_FRACTION = 3;

export interface E2BKeepaliveHandle {
  /** Stop refreshing. Idempotent; safe to call from a `finally` even if never started. */
  stop: () => void;
}

export type ExtendE2BTimeout = (
  sandboxId: string,
  timeoutMs: number,
) => Promise<void>;

/**
 * Compute the refresh interval for a given timeout: timeoutMs / 3, clamped to
 * `MIN_REFRESH_INTERVAL_MS` so a very small (e.g. test) timeout cannot spin.
 */
export function e2bKeepaliveIntervalMs(timeoutMs: number): number {
  return Math.max(MIN_REFRESH_INTERVAL_MS, Math.floor(timeoutMs / REFRESH_FRACTION));
}

/**
 * Start refreshing an E2B sandbox's timeout on an interval so it measures idle time (since the
 * last successful refresh) rather than run duration since creation.
 *
 * `extend` is injectable so this is unit-testable with a fake handle; the real caller passes a
 * thin wrapper around `Sandbox.setTimeout` from `@e2b/code-interpreter`. Failures are logged and
 * swallowed — a transient API error should not crash the run; worst case the sandbox reaps at
 * the original deadline, same as before this feature existed.
 */
export function startE2BKeepalive(
  sandboxId: string,
  timeoutMs: number,
  extend: ExtendE2BTimeout,
  log: Log = () => {},
): E2BKeepaliveHandle {
  const intervalMs = e2bKeepaliveIntervalMs(timeoutMs);

  const refresh = (): void => {
    void extend(sandboxId, timeoutMs).catch((err) => {
      log(
        `e2b keepalive refresh failed sandbox=${sandboxId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
  };

  const interval = setInterval(refresh, intervalMs);
  // Allow the Node process to exit even if the interval is still pending (mirrors the alive
  // watchdog in sessions/alive.ts).
  if ((interval as unknown as { unref?: () => void }).unref) {
    (interval as unknown as { unref: () => void }).unref();
  }

  return {
    stop: () => clearInterval(interval),
  };
}

/**
 * The real `extend` implementation: `Sandbox.setTimeout` is a static method, so it needs no
 * live `Sandbox` instance — only the sandbox ID (`SandboxAgent.sandboxId`, already available to
 * the caller after `startSandboxAgent`) and an API key, which defaults to `E2B_API_KEY` from
 * the environment exactly like the `sandbox-agent/e2b` provider's own `Sandbox.connect` calls.
 */
export const extendE2BSandboxTimeout: ExtendE2BTimeout = (sandboxId, timeoutMs) =>
  Sandbox.setTimeout(sandboxId, timeoutMs);
