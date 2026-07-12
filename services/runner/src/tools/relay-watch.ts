/**
 * Hop 2 wake sources for the runner's relay loop (tools/relay.ts, plan decisions 3, 4,
 * 6, 7 of docs/design/agent-workflows/projects/event-driven-tool-relay/plan.md).
 *
 * Two implementations of one contract (`RelayActivitySource`):
 *
 * - `localRelayActivitySource`: an in-process `fs.watch` on the relay dir for the local
 *   backend. No flag; a wake only shortens the poll sleep, the cadence is unchanged.
 * - `daytonaRelayActivitySource`: a re-issued bounded watch exec (`node -e` inside the
 *   sandbox via `sandbox.runProcess`) that REPLACES the runner's remote polling while
 *   healthy, backed by a 30 s safety poll and demoted to classic polling after repeated
 *   failure. Behind `AGENTA_AGENT_TOOLS_RELAY_REMOTE_WATCH_ENABLED` (default false).
 *
 * This module is SERVER-SIDE: it may import ./relay-client.ts and ./relay-protocol.ts,
 * but must never be imported by them (they are bundled into the sandbox; the acceptance
 * gate greps the extension bundle for this module's symbols).
 */
import { createRelayDirWatch } from "./relay-client.ts";

export interface RelayActivitySource {
  wait(options: {
    timeoutMs: number;
    signal?: AbortSignal;
  }): Promise<"activity" | "timeout" | "closed">;
  close(): void;
  /** False once the source is demoted or closed; the relay loop then uses classic polling. */
  isHealthy(): boolean;
  /** Whether a healthy source replaces the remote poll (Daytona watch: true; local fs.watch: false). */
  readonly suspendsPolling: boolean;
  /** Optional: a request discovered by the safety poll while healthy counts as a watch miss (feeds demotion). */
  noteMiss?(): void;
}

/**
 * Hop 2 remote-watch kill switch (plan decision 7), read at call time. Default FALSE
 * (flips to true after the QA pass); only the exact strings "true" and "1" enable it.
 */
export function remoteWatchEnabled(): boolean {
  const value = process.env.AGENTA_AGENT_TOOLS_RELAY_REMOTE_WATCH_ENABLED;
  return value === "true" || value === "1";
}

/**
 * The runner's remote `ls` cadence while a suspended-polling watch is healthy (plan
 * decision 4): pickup latency stays bounded by this no matter what the watch subsystem
 * does, including lying about success.
 */
export const RELAY_SAFETY_POLL_MS = 30_000;

/** Default bounded lifetime of one watch exec window (plan decision 7). */
export const RELAY_REMOTE_WATCH_WINDOW_DEFAULT_MS = 25_000;
/** Clamp floor: below 5 s the re-issue cadence becomes the request storm this removes. */
export const RELAY_REMOTE_WATCH_WINDOW_MIN_MS = 5_000;
/** Clamp ceiling: above 2 min the bounded-lifetime and orphan-cleanup assumptions stop holding. */
export const RELAY_REMOTE_WATCH_WINDOW_MAX_MS = 120_000;
/** Daemon-timeout grace on top of the window so normal expiry never reads as a daemon timeout. */
const RELAY_REMOTE_WATCH_GRACE_MS = 5_000;
/** The in-sandbox script's own periodic readdir (the in-window correctness fallback). */
const RELAY_WATCH_READDIR_POLL_MS = 2_000;
/** Consecutive failures before the source demotes itself to classic polling. */
const RELAY_WATCH_DEMOTION_THRESHOLD = 3;
const RELAY_WATCH_BACKOFF_BASE_MS = 1_000;
const RELAY_WATCH_BACKOFF_CAP_MS = 30_000;

/**
 * Parse and clamp `AGENTA_AGENT_TOOLS_RELAY_REMOTE_WATCH_WINDOW_MS` (plan decision 7).
 * Read once at source creation. Missing -> default silently; set-but-unparseable ->
 * default with one warning; out of range -> clamped with one warning.
 */
export function resolveRemoteWatchWindowMs(
  log: (msg: string) => void = () => {},
): number {
  const raw = process.env.AGENTA_AGENT_TOOLS_RELAY_REMOTE_WATCH_WINDOW_MS;
  if (raw === undefined || raw === "")
    return RELAY_REMOTE_WATCH_WINDOW_DEFAULT_MS;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) {
    log(
      `[relay] unparseable AGENTA_AGENT_TOOLS_RELAY_REMOTE_WATCH_WINDOW_MS '${raw}'; using default ${RELAY_REMOTE_WATCH_WINDOW_DEFAULT_MS}`,
    );
    return RELAY_REMOTE_WATCH_WINDOW_DEFAULT_MS;
  }
  if (parsed < RELAY_REMOTE_WATCH_WINDOW_MIN_MS) {
    log(
      `[relay] AGENTA_AGENT_TOOLS_RELAY_REMOTE_WATCH_WINDOW_MS ${parsed} below minimum; clamped to ${RELAY_REMOTE_WATCH_WINDOW_MIN_MS}`,
    );
    return RELAY_REMOTE_WATCH_WINDOW_MIN_MS;
  }
  if (parsed > RELAY_REMOTE_WATCH_WINDOW_MAX_MS) {
    log(
      `[relay] AGENTA_AGENT_TOOLS_RELAY_REMOTE_WATCH_WINDOW_MS ${parsed} above maximum; clamped to ${RELAY_REMOTE_WATCH_WINDOW_MAX_MS}`,
    );
    return RELAY_REMOTE_WATCH_WINDOW_MAX_MS;
  }
  return parsed;
}

/**
 * DOWNWARD-ONLY jitter (−20%..0%): windows and backoffs never re-issue in lockstep
 * (fleet desync is preserved), and a jittered window is always <= the nominal window,
 * so a 25 s default window always completes before the 30 s safety wait — an upward
 * draw used to race the safety poll and read as a false watch miss. Deliberate
 * deviation from the plan's ±20% (decision 4/7), recorded here.
 */
export function applyRelayWatchJitter(ms: number): number {
  return Math.round(ms * (0.8 + Math.random() * 0.2));
}

/**
 * Local-backend hop 2 wake source: the in-process `fs.watch` adapter over the shared
 * coalescing dir watch (relay-client.ts). It never suspends polling — a wake only
 * shortens the sleep, so a degraded inner watch just means waits resolve by timer and
 * the loop's cadence is unchanged; no demotion machinery needed (isHealthy stays true
 * until closed). A dir that cannot be watched returns undefined (plain poll).
 */
export function localRelayActivitySource(
  dir: string,
): RelayActivitySource | undefined {
  const dirWatch = createRelayDirWatch(dir);
  if (!dirWatch) return undefined;
  let closed = false;
  return {
    suspendsPolling: false,
    isHealthy: () => !closed,
    wait: async ({ timeoutMs }) => {
      if (closed) return "closed";
      // The inner watch resolves a wait cut short by close() as "timeout"; the closed
      // flag remaps it (and any later wait) to "closed" for the activity-source contract.
      const outcome = await dirWatch.wait(timeoutMs);
      return closed ? "closed" : outcome;
    },
    close: () => {
      if (closed) return;
      closed = true;
      dirWatch.close();
    },
  };
}

/**
 * The in-sandbox watch script (plan decision 4, hardening list). Plain CommonJS for
 * `node -e`. Argv only — the relay dir is NEVER interpolated into this source (a path
 * with quotes, whitespace, newlines, or shell metacharacters must be safe; runProcess
 * passes argv directly with no shell). Order matters: arm `fs.watch` FIRST, then the
 * sync readdir check (a file landing during either fires the already-armed watch), then
 * the interval + window timer. `finish()` is idempotent, guards not-yet-assigned
 * handles, never calls process.exit() and never writes stdout: it just releases every
 * handle so the event loop drains and the process exits 0 — the exec COMPLETION is the
 * wake signal. A synchronous `fs.watch` throw (dir missing) leaves the interval + timer
 * running: the script degrades to an in-sandbox readdir poll for the window.
 */
export const RELAY_WATCH_SCRIPT = `"use strict";
const fs = require("fs");
const dir = process.argv[1];
const windowMs = Number(process.argv[2]);
const readdirPollMs = Number(process.argv[3]);
let finished = false;
let watcher;
let interval;
let timer;
function finish() {
  if (finished) return;
  finished = true;
  if (watcher) {
    try {
      watcher.close();
    } catch (e) {}
  }
  if (interval) clearInterval(interval);
  if (timer) clearTimeout(timer);
}
try {
  watcher = fs.watch(dir, finish);
  watcher.on("error", finish);
} catch (e) {}
function hasReq() {
  try {
    return fs.readdirSync(dir).some(function (n) {
      return n.endsWith(".req.json");
    });
  } catch (e) {
    return false;
  }
}
if (hasReq()) finish();
if (!finished) {
  interval = setInterval(function () {
    if (hasReq()) finish();
  }, readdirPollMs);
  timer = setTimeout(finish, windowMs);
}
`;

/**
 * Build the exec argv for one watch window. `node -e` argv semantics, verified
 * empirically (`node -e 'console.log(process.argv)' a b` prints
 * `[execPath, "a", "b"]`): the script sees the trailing arguments starting at
 * `process.argv[1]`, so argv[1] = relay dir, argv[2] = window ms, argv[3] = readdir
 * poll ms. The dir rides argv, never the script text.
 */
export function buildRelayWatchScriptArgs(
  dir: string,
  windowMs: number,
  readdirPollMs: number,
): { command: string; args: string[] } {
  return {
    command: "node",
    args: [
      "-e",
      RELAY_WATCH_SCRIPT,
      dir,
      String(windowMs),
      String(readdirPollMs),
    ],
  };
}

/** The one daemon call this source issues; matches sandbox-agent's `runProcess`. */
export interface RelayWatchSandbox {
  runProcess: (request: {
    command: string;
    args: string[];
    timeoutMs: number;
  }) => Promise<
    { exitCode?: number | null; timedOut?: boolean } | undefined | null
  >;
}

/** Runner-side slack on top of the daemon bound before a never-settling exec is abandoned. */
const RELAY_WATCH_OUTER_BOUND_MARGIN_MS = 2_000;

export interface DaytonaRelayActivitySourceOptions {
  windowMs?: number;
  readdirPollMs?: number;
  backoffBaseMs?: number;
  backoffCapMs?: number;
  /** Daemon-timeout grace over the jittered window (default 5 s); injectable for tests. */
  graceMs?: number;
  /** Runner-side outer-bound margin over window + grace (default 2 s); injectable for tests. */
  outerBoundMarginMs?: number;
  log?: (msg: string) => void;
}

/**
 * Daytona hop 2 wake source (plan decisions 3 + 4): the single-flight window loop.
 * While healthy it replaces the runner's remote `ls` polling (`suspendsPolling`): each
 * `wait()` arms at most one bounded watch exec in the sandbox and treats the exec's
 * COMPLETION as the wake. Repeated failure (exec rejection, daemon timeout, or a
 * safety-poll discovery the watch missed) demotes the source for the turn, with
 * jittered exponential backoff on the way there, and the loop reverts to classic
 * polling.
 */
export function daytonaRelayActivitySource(
  sandbox: RelayWatchSandbox,
  dir: string,
  opts?: DaytonaRelayActivitySourceOptions,
): RelayActivitySource {
  const log = opts?.log ?? (() => {});
  const windowMs = opts?.windowMs ?? resolveRemoteWatchWindowMs(log);
  const readdirPollMs = opts?.readdirPollMs ?? RELAY_WATCH_READDIR_POLL_MS;
  const backoffBaseMs = opts?.backoffBaseMs ?? RELAY_WATCH_BACKOFF_BASE_MS;
  const backoffCapMs = opts?.backoffCapMs ?? RELAY_WATCH_BACKOFF_CAP_MS;
  const graceMs = opts?.graceMs ?? RELAY_REMOTE_WATCH_GRACE_MS;
  const outerBoundMarginMs =
    opts?.outerBoundMarginMs ?? RELAY_WATCH_OUTER_BOUND_MARGIN_MS;

  let closed = false;
  let demoted = false;
  let stickyActivity = false;
  let consecutiveFailures = 0;
  let nextArmAt = 0;
  let inFlight = false;
  // Window generations: each armWindow gets a fresh generation, and only the LIVE
  // generation may settle. The outer-bound timer abandons a never-settling exec by
  // killing its generation, so a late settle from the abandoned promise is ignored
  // entirely (no wake, no counter reset, no inFlight mutation).
  let armGeneration = 0;
  let liveGeneration = 0; // 0 = no live window
  let outerBoundTimer: ReturnType<typeof setTimeout> | undefined;
  let waiter:
    | ((outcome: "activity" | "timeout" | "closed") => void)
    | undefined;

  const clearOuterBound = (): void => {
    if (outerBoundTimer !== undefined) {
      clearTimeout(outerBoundTimer);
      outerBoundTimer = undefined;
    }
  };

  /**
   * The single failure account (finding 4 of the slice-2 review): every failure —
   * exec rejection, daemon timeout, nonzero/null exit, outer-bound expiry, safety-poll
   * miss — increments the counter, applies jittered exponential backoff to the next
   * arm, logs one line, and demotes at the threshold (exactly one demotion log ever).
   */
  const countFailure = (reason: string): void => {
    consecutiveFailures += 1;
    log(`[relay] watch failure: ${reason}`);
    const raw = Math.min(
      backoffBaseMs * 2 ** Math.max(0, consecutiveFailures - 1),
      backoffCapMs,
    );
    nextArmAt = Date.now() + applyRelayWatchJitter(raw);
    if (!demoted && consecutiveFailures >= RELAY_WATCH_DEMOTION_THRESHOLD) {
      demoted = true;
      log(
        `[relay] relay watch demoted to classic polling after ${consecutiveFailures} consecutive failures (${reason})`,
      );
    }
  };

  /** Window completion or a straggler wake: resolve the waiter or set the sticky bit. */
  const wake = (): void => {
    if (closed) return;
    if (waiter) {
      const resolve = waiter;
      waiter = undefined;
      resolve("activity");
    } else {
      stickyActivity = true;
    }
  };

  const armWindow = (): void => {
    inFlight = true;
    const gen = ++armGeneration;
    liveGeneration = gen;
    const jitteredWindow = applyRelayWatchJitter(windowMs);
    const { command, args } = buildRelayWatchScriptArgs(
      dir,
      jitteredWindow,
      readdirPollMs,
    );
    // Issue the exec synchronously (single-flight accounting and the counting test
    // observe it at arm time); a synchronously-throwing runProcess still lands in the
    // .catch below instead of escaping armWindow.
    let window: Promise<
      { exitCode?: number | null; timedOut?: boolean } | undefined | null
    >;
    try {
      window = Promise.resolve(
        sandbox.runProcess({
          command,
          args,
          timeoutMs: jitteredWindow + graceMs,
        }),
      );
    } catch (err) {
      window = Promise.reject(err);
    }
    // Runner-side outer bound: the daemon's timeoutMs is a promise the daemon may
    // never keep (a blackholed proxy leaves runProcess pending forever, pinning
    // inFlight and starving demotion). Past window + grace + margin a still-pending
    // window is abandoned: counted as a failure, inFlight cleared, generation killed.
    outerBoundTimer = setTimeout(
      () => {
        outerBoundTimer = undefined;
        if (closed || gen !== liveGeneration) return;
        liveGeneration = 0;
        inFlight = false;
        countFailure("window outer bound expired (exec never settled)");
      },
      jitteredWindow + graceMs + outerBoundMarginMs,
    );
    window
      .then((result) => {
        if (gen !== liveGeneration) return; // abandoned by the outer bound: dead gen
        liveGeneration = 0;
        clearOuterBound();
        inFlight = false;
        if (closed) return; // abandoned window (see close()); its wake is meaningless now
        if (result?.timedOut === true) {
          // The daemon killed the exec past window + grace: the script never expired on
          // its own timer, so this is a failure, not a wake.
          countFailure("daemon timeout");
          return;
        }
        const exitCode = result?.exitCode;
        if (exitCode === 0 || exitCode === undefined) {
          consecutiveFailures = 0;
        } else {
          // Nonzero or null (signal-killed / OOM) exit is still a wake (the list pass
          // is harmless) but counts as a failure so a script that keeps dying demotes
          // the source; null must not read as success.
          countFailure(`watch script exited with code ${exitCode}`);
        }
        wake();
      })
      .catch((err) => {
        if (gen !== liveGeneration) return; // abandoned: keep the rejection handled, mutate nothing
        liveGeneration = 0;
        clearOuterBound();
        inFlight = false;
        if (closed) return;
        // The exec could not run at all: failure, backoff, and NO wake (the waiter's
        // own timer resolves "timeout"). Never rethrown: a rejecting exec must never
        // reject wait() or become an unhandled rejection.
        countFailure(
          `exec rejected: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
  };

  return {
    suspendsPolling: true,
    isHealthy: () => !demoted && !closed,
    noteMiss: () => {
      if (closed || demoted) return;
      // The safety poll found a request while a window claimed healthy: the watch lied.
      countFailure("safety poll found a request the watch missed");
    },
    wait: ({ timeoutMs, signal }) => {
      if (closed) return Promise.resolve("closed");
      if (stickyActivity) {
        stickyActivity = false;
        return Promise.resolve("activity");
      }
      if (signal?.aborted) return Promise.resolve("closed");
      if (!demoted && !inFlight && Date.now() >= nextArmAt) armWindow();
      return new Promise((resolve) => {
        let settled = false;
        let deferredArmTimer: ReturnType<typeof setTimeout> | undefined;
        const settle = (outcome: "activity" | "timeout" | "closed"): void => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (deferredArmTimer !== undefined) clearTimeout(deferredArmTimer);
          if (waiter === settle) waiter = undefined;
          signal?.removeEventListener("abort", onAbort);
          resolve(outcome);
        };
        const onAbort = (): void => settle("closed");
        // The timer win clears the waiter and the abort listener via settle, so
        // thousands of consecutive waits accumulate zero listeners and zero timers.
        const timer = setTimeout(() => settle("timeout"), timeoutMs);
        waiter = settle;
        signal?.addEventListener("abort", onAbort, { once: true });
        // Deferred arm: a wait that starts inside a backoff gap would otherwise sit
        // windowless for its whole timeout (up to the 30 s safety wait). Arm when the
        // gate opens, inside this wait; cleared on settle. Re-scheduled if the timer
        // fires marginally early (Node truncates delays) or the gate moved (another
        // failure pushed nextArmAt) while this wait was parked.
        const scheduleDeferredArm = (): void => {
          deferredArmTimer = setTimeout(
            () => {
              deferredArmTimer = undefined;
              if (settled || closed || demoted || inFlight) return;
              if (Date.now() < nextArmAt) {
                scheduleDeferredArm();
                return;
              }
              armWindow();
            },
            Math.max(1, nextArmAt - Date.now()),
          );
        };
        if (!demoted && !inFlight && Date.now() < nextArmAt) {
          scheduleDeferredArm();
        }
      });
    },
    close: () => {
      if (closed) return;
      closed = true;
      clearOuterBound();
      // The in-flight runProcess CANNOT be aborted: the SDK's runProcess takes no
      // per-call AbortSignal (verified against node_modules/sandbox-agent/dist/
      // index.d.ts; only connection-level signals exist). Deviation from plan
      // invariant 5 ("aborts the in-flight held exec request"), softened to
      // abandon-with-bounded-lifetime: the completion handler above no-ops once
      // closed, its .catch keeps a late rejection handled, and the in-sandbox script
      // dies at its own window timer (<= window + grace).
      if (waiter) {
        const resolve = waiter;
        waiter = undefined;
        resolve("closed");
      }
    },
  };
}
