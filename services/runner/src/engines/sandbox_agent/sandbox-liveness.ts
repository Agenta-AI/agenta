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
 * So probe the sandbox directly, over its own HTTP surface, which is a different socket from the
 * wedged ACP channel: it answers while the sandbox lives and refuses once it is gone.
 * `failureThreshold` consecutive failures — not one — is what separates a dead sandbox from a
 * slow network, and each probe carries its own timeout because a vanished host can hang a
 * request rather than refuse it.
 *
 * What counts as alive is deliberately weak: ANY HTTP response, including 401 or 404. The
 * question is whether something is listening, not whether we are authorised or whether the
 * route exists, and only a transport failure answers that with certainty.
 *
 * The ONE exception is an answer that names the SANDBOX as gone, which `sandbox-gone.ts`
 * recognises. Behind a remote provider's proxy the transport failure never arrives: Daytona keeps
 * the proxy host up after the sandbox is deleted and answers "sandbox <id> not found" for it
 * indefinitely, so the weak rule alone read a dead sandbox as alive and the turn hung until the
 * runner process died. That answer is the provider's own verdict rather than a network symptom,
 * so it ends the turn on the FIRST sighting instead of after three failures.
 *
 * `goneSignal` is the other half of the same fix. The ACP transport carrying the turn sees that
 * answer seconds before any poll can, and it cannot end a turn on its own, so it notes the death
 * on a shared latch and this probe fires on the latch at once.
 *
 * NOTE on what NOT to probe: `SandboxAgent.getSession()` looks like a liveness check and is not
 * one. It reads the local persist driver and never touches the daemon, so it answers happily
 * while the sandbox is dead — verified live on 2026-09-02, where a killed daemon logged
 * `ECONNREFUSED` on the ACP socket while every `getSession` succeeded.
 *
 * The probe deliberately keeps running while the turn is paused. A pause is a legitimate wait for
 * a human; it is not a reason to stop noticing that the machine underneath is gone.
 */

import { envInt, envTimerMs } from "../../env.ts";
import { SANDBOX_GONE_MARKER } from "./errors.ts";
import { sandboxGoneReason, type SandboxGoneLatch } from "./sandbox-gone.ts";

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
    intervalMs: envTimerMs(PROBE_INTERVAL_ENV, DEFAULT_PROBE_INTERVAL_MS, {
      log,
    }),
    timeoutMs: envTimerMs(PROBE_TIMEOUT_ENV, DEFAULT_PROBE_TIMEOUT_MS, { log }),
    failureThreshold: envInt(PROBE_FAILURES_ENV, DEFAULT_PROBE_FAILURES, {
      min: 1,
      log,
    }),
  };
}

/**
 * The daemon's health URL, derived from the only public handle on the agent that carries its
 * base address. `inspectorUrl` is `<base>/ui/`; the health route is `<base>/v1/health`.
 *
 * Returns undefined when the agent exposes no usable URL, which disables the probe rather than
 * guessing — a probe pointed at the wrong host would end healthy turns.
 */
export function sandboxHealthUrl(sandbox: unknown): string | undefined {
  const inspector = (sandbox as { inspectorUrl?: unknown } | undefined)
    ?.inspectorUrl;
  if (typeof inspector !== "string" || !inspector) return undefined;
  const base = inspector.replace(/\/ui\/?$/, "").replace(/\/+$/, "");
  if (!/^https?:\/\//.test(base)) return undefined;
  return `${base}/v1/health`;
}

/**
 * A failure the provider itself confirmed: the sandbox is gone, so waiting for two more probes
 * would only delay an outcome that is already certain.
 */
export class SandboxGoneError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "SandboxGoneError";
  }
}

/**
 * The default probe: one unauthenticated GET at the daemon's health route.
 *
 * Resolves on any HTTP status, except one whose headers or body name the sandbox as gone — that
 * rejects with {@link SandboxGoneError}. Otherwise it rejects only when the request never became a
 * response, which is what "nothing is listening any more" looks like from here.
 *
 * The body is read only for an HTTP error, so a healthy answer costs nothing extra and a 200 that
 * happens to quote the provider's prose can never be misread as death.
 */
export function httpLivenessProbe(url: string): () => Promise<unknown> {
  return async () => {
    const response = await fetch(url, { method: "GET" });
    const bodyText =
      response.status >= 400
        ? await response.text().catch(() => "")
        : undefined;
    const reason = sandboxGoneReason(response, bodyText);
    if (reason) throw new SandboxGoneError(reason);
    return response.status;
  };
}

export interface SandboxLivenessHandle {
  /** Release the probe's timer. Always call this once the turn ends, on every path. */
  dispose(): void;
  /** Consecutive failures observed so far; for tests and diagnostics. */
  failures(): number;
}

export interface SandboxLivenessOptions {
  /**
   * One liveness check. Resolves when the sandbox answered, rejects or hangs when it did not.
   *
   * Optional: a sandbox that exposes no health URL still gets the `goneSignal` route, which needs
   * no polling at all.
   */
  probe?: () => Promise<unknown>;
  limits: SandboxLivenessLimits;
  /** Called at most once, with a human-readable reason, when the sandbox is declared gone. */
  onGone: (reason: string) => void;
  /**
   * The latch the turn's ACP transport writes to when a response names the sandbox as gone. It
   * ends the turn on the spot, without waiting for the next probe interval.
   */
  goneSignal?: SandboxGoneLatch;
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
  goneSignal,
  clock = realClock,
  log = () => {},
}: SandboxLivenessOptions): SandboxLivenessHandle {
  let disposed = false;
  let fired = false;
  let inFlight = false;
  let failures = 0;
  let timer: NodeJS.Timeout | undefined;

  /** Declare the sandbox gone, at most once for the life of this handle. */
  const fire = (reason: string): void => {
    if (fired || disposed) return;
    fired = true;
    if (timer) clock.clearTimeout(timer);
    timer = undefined;
    log(`[sandbox-liveness] ${reason}`);
    onGone(reason);
  };

  const schedule = (): void => {
    if (disposed || fired) return;
    timer = clock.setTimeout(() => void tick(), limits.intervalMs);
  };

  const withTimeout = async (): Promise<void> => {
    let timeoutHandle: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        probe!(),
        new Promise<never>((_resolve, reject) => {
          timeoutHandle = clock.setTimeout(
            () =>
              reject(new Error(`probe timed out after ${limits.timeoutMs}ms`)),
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
      // The provider answering "that sandbox does not exist" is a verdict, not a symptom, so it
      // needs no corroboration from two more probes.
      if (err instanceof SandboxGoneError) {
        log(`[sandbox-liveness] probe failed (definitive): ${detail}`);
        fire(`${SANDBOX_GONE_MARKER}: ${detail}`);
        return;
      }
      log(
        `[sandbox-liveness] probe failed (${failures}/${limits.failureThreshold}): ${detail}`,
      );
      if (failures >= limits.failureThreshold) {
        fire(
          `${SANDBOX_GONE_MARKER}: ${failures} consecutive liveness probes failed ` +
            `(last: ${detail})`,
        );
        return;
      }
    } finally {
      inFlight = false;
    }
    schedule();
  };

  // The transport's report is not a poll, so `PROBE_DISABLED_ENV` does not silence it: that switch
  // exists to stop the runner making a request per sandbox per tick, not to make the runner ignore
  // a death it was told about. The latch belongs to the ENVIRONMENT, which outlives this turn on a
  // warm sandbox, so `dispose` must hand the listener back or every turn leaves one behind.
  const unsubscribeGone = goneSignal?.subscribe((reason) => {
    fire(`${SANDBOX_GONE_MARKER}: ${reason}`);
  });

  if (probe && !process.env[PROBE_DISABLED_ENV]) schedule();

  return {
    dispose() {
      disposed = true;
      if (timer) clock.clearTimeout(timer);
      timer = undefined;
      unsubscribeGone?.();
    },
    failures: () => failures,
  };
}
