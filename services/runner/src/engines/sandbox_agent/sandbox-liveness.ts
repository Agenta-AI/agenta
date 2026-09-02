/**
 * Detect that the sandbox died UNDER a running turn, so the turn ends instead of hanging.
 *
 * The runner talks to the sandbox agent over ACP, a JSON-RPC channel whose agent-to-client half
 * is a long-lived SSE `GET`. When the sandbox process disappears that stream is severed, but the
 * transport's read loop swallows the error and never fails the readable, so the pending
 * `session/prompt` request is structurally incapable of settling. The turn then holds its
 * sandbox, its mount and its slot forever, while the alive watchdog keeps telling the platform
 * `running=true` every 30 seconds. That is issue #6418.
 *
 * The existing run limits do not cover it. Time-to-first-byte (2 min) catches a sandbox that
 * dies before the first token, and idle (30 min) catches one that dies mid-stream — but
 * `notePaused()` retires every one of them for good the moment the turn parks for a human, and a
 * sandbox that dies during a pause therefore has no deadline at all.
 *
 * So probe the sandbox directly. A cheap REST call on the daemon's own HTTP surface is
 * independent of the wedged ACP channel: it answers while the sandbox lives and fails once it is
 * gone. `failureThreshold` consecutive failures — not one — is what separates a dead sandbox from
 * a slow network, and each probe carries its own timeout because a vanished host can hang a
 * request rather than refuse it.
 *
 * The probe deliberately keeps running while the turn is paused. A pause is a legitimate wait for
 * a human; it is not a reason to stop noticing that the machine underneath is gone.
 */

import { envInt, envTimerMs } from "../../env.ts";
import { SANDBOX_GONE_MARKER } from "./errors.ts";

export const PROBE_INTERVAL_ENV = "AGENTA_RUNNER_SANDBOX_PROBE_INTERVAL_MS";
export const PROBE_TIMEOUT_ENV = "AGENTA_RUNNER_SANDBOX_PROBE_TIMEOUT_MS";
export const PROBE_FAILURES_ENV = "AGENTA_RUNNER_SANDBOX_PROBE_FAILURES";
export const PROBE_DISABLED_ENV = "AGENTA_RUNNER_SANDBOX_PROBE_DISABLED";

// One probe per heartbeat interval. Anything faster buys latency the user cannot perceive and
// costs a request per sandbox per tick.
export const DEFAULT_PROBE_INTERVAL_MS = 30_000;
// A live daemon answers a session read in milliseconds; ten seconds is a generous ceiling that
// still bounds a hung request well inside one interval.
export const DEFAULT_PROBE_TIMEOUT_MS = 10_000;
// Three consecutive failures, so a single dropped request or a brief network stall is not a
// death sentence. At the defaults that is about 90 seconds before a turn is ended.
export const DEFAULT_PROBE_FAILURES = 3;

export interface SandboxLivenessLimits {
  intervalMs: number;
  timeoutMs: number;
  failureThreshold: number;
}

export interface Clock {
  setTimeout(fn: () => void, ms: number): NodeJS.Timeout;
  clearTimeout(handle: NodeJS.Timeout): void;
}

const realClock: Clock = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle),
};

/** Read the probe's limits from env, with wide defaults. */
export function resolveSandboxLivenessLimits(
  log: (message: string) => void = () => {},
): SandboxLivenessLimits {
  return {
    intervalMs: envTimerMs(PROBE_INTERVAL_ENV, DEFAULT_PROBE_INTERVAL_MS, { log }),
    timeoutMs: envTimerMs(PROBE_TIMEOUT_ENV, DEFAULT_PROBE_TIMEOUT_MS, { log }),
    failureThreshold: envInt(PROBE_FAILURES_ENV, DEFAULT_PROBE_FAILURES, {
      min: 1,
      log,
    }),
  };
}

export interface SandboxLivenessHandle {
  /** Release the probe's timer. Always call this once the turn ends, on every path. */
  dispose(): void;
  /** Consecutive failures observed so far; for tests and diagnostics. */
  failures(): number;
}

export interface SandboxLivenessOptions {
  /** One liveness check. Resolves when the sandbox answered, rejects or hangs when it did not. */
  probe: () => Promise<unknown>;
  limits: SandboxLivenessLimits;
  /** Called at most once, with a human-readable reason, when the sandbox is declared gone. */
  onGone: (reason: string) => void;
  clock?: Clock;
  log?: (message: string) => void;
}

/**
 * Start probing. Returns immediately; the first probe runs one interval later, because a turn
 * that just acquired its environment has already proved the sandbox was up.
 */
export function startSandboxLivenessProbe({
  probe,
  limits,
  onGone,
  clock = realClock,
  log = () => {},
}: SandboxLivenessOptions): SandboxLivenessHandle {
  let disposed = false;
  let fired = false;
  let inFlight = false;
  let failures = 0;
  let timer: NodeJS.Timeout | undefined;

  const schedule = (): void => {
    if (disposed || fired) return;
    timer = clock.setTimeout(() => void tick(), limits.intervalMs);
  };

  const withTimeout = async (): Promise<void> => {
    let timeoutHandle: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        probe(),
        new Promise<never>((_resolve, reject) => {
          timeoutHandle = clock.setTimeout(
            () => reject(new Error(`probe timed out after ${limits.timeoutMs}ms`)),
            limits.timeoutMs,
          );
        }),
      ]);
    } finally {
      if (timeoutHandle) clock.clearTimeout(timeoutHandle);
    }
  };

  const tick = async (): Promise<void> => {
    // A probe still running when the next tick lands means the sandbox is not answering; let
    // the in-flight one reach its own timeout rather than stacking requests on a dead host.
    if (disposed || fired || inFlight) {
      schedule();
      return;
    }
    inFlight = true;
    try {
      await withTimeout();
      failures = 0;
    } catch (err) {
      failures += 1;
      const detail = err instanceof Error ? err.message : String(err);
      log(
        `[sandbox-liveness] probe failed (${failures}/${limits.failureThreshold}): ${detail}`,
      );
      if (failures >= limits.failureThreshold && !fired && !disposed) {
        fired = true;
        const reason =
          `${SANDBOX_GONE_MARKER}: ${failures} consecutive liveness probes failed ` +
          `(last: ${detail})`;
        log(`[sandbox-liveness] ${reason}`);
        onGone(reason);
        return;
      }
    } finally {
      inFlight = false;
    }
    schedule();
  };

  if (!process.env[PROBE_DISABLED_ENV]) schedule();

  return {
    dispose() {
      disposed = true;
      if (timer) clock.clearTimeout(timer);
      timer = undefined;
    },
    failures: () => failures,
  };
}
