/**
 * Guarantee that a turn ends, even when `run()` does not.
 *
 * The runner's terminal record, and the release of its alive watchdog, both sit downstream of
 * `await run(...)`. That is correct for every path where `run()` returns, and it is the whole
 * bug where it does not: an await inside the run that never settles leaves the heartbeat
 * announcing `running=true` every thirty seconds forever, so the platform holds the session
 * open under a turn nobody is running and no terminal record is ever written. See issues #6418,
 * #6100 and #5327.
 *
 * This module bounds that. It waits for `run()` normally, and gives up on it when either:
 *
 * * the platform says this turn is no longer current (a Stop, a takeover, or the API's own
 *   execution watchdog declaring the turn lost), or
 * * the hard deadline elapses.
 *
 * Giving up is two steps, never one. First `abort()`, because most hangs DO unwind from an
 * abort — the prompt race inside the turn resolves on the signal — and an unwound turn tears
 * its sandbox down properly. Only if the run is still pending after `abandonGraceMs` does the
 * caller stop waiting and write the outcome itself.
 *
 * What this deliberately does NOT do: kill the sandbox, or change any teardown rule. The
 * abandoned `run()` still owns its environment and still runs its own `finally` if it ever
 * settles. This is about the platform always learning the outcome, not about reclaiming
 * machines — the keep-alive pool and the API watchdog already own that.
 */

import { envTimerMs } from "../env.ts";
import { DEFAULT_TOTAL_DEADLINE_MS } from "../engines/sandbox_agent/run-limits.ts";

export const HARD_DEADLINE_ENV = "AGENTA_RUNNER_TURN_HARD_DEADLINE_MS";
export const ABANDON_GRACE_ENV = "AGENTA_RUNNER_TURN_ABANDON_GRACE_MS";

/**
 * Half an hour past the longest legitimate run.
 *
 * This is a backstop, not a policy: it must never be the limit that ends a real turn, because
 * the run limits already own that decision and users have asked for LONGER runs, not shorter
 * ones (issues #6084, #5356). Keeping it above `DEFAULT_TOTAL_DEADLINE_MS` means a turn that
 * reaches it is one whose own deadline already tripped and failed to end it.
 */
export const DEFAULT_HARD_DEADLINE_MS = DEFAULT_TOTAL_DEADLINE_MS + 30 * 60_000;

/**
 * How long a turn may take to unwind after its abort before the caller stops waiting.
 *
 * Long enough for a normal teardown (flush the trace, settle the interaction rows, destroy or
 * park the sandbox), short enough that a user who pressed Stop is not left watching a spinner.
 */
export const DEFAULT_ABANDON_GRACE_MS = 60_000;

export interface TurnSettleLimits {
  hardDeadlineMs: number;
  abandonGraceMs: number;
}

export interface Clock {
  setTimeout(fn: () => void, ms: number): NodeJS.Timeout;
  clearTimeout(handle: NodeJS.Timeout): void;
}

const realClock: Clock = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle),
};

export function resolveTurnSettleLimits(
  log: (message: string) => void = () => {},
): TurnSettleLimits {
  return {
    hardDeadlineMs: envTimerMs(HARD_DEADLINE_ENV, DEFAULT_HARD_DEADLINE_MS, {
      log,
    }),
    abandonGraceMs: envTimerMs(ABANDON_GRACE_ENV, DEFAULT_ABANDON_GRACE_MS, {
      log,
    }),
  };
}

export type TurnSettleOutcome<T> =
  /** `run()` returned. The normal path, and the only one that carries the run's own result. */
  | { settled: true; value: T }
  /** `run()` never returned. The caller must write the terminal outcome itself. */
  | { settled: false; reason: string };

export interface AwaitTurnOptions<T> {
  /** The in-flight run. Never rejected by this function; the caller keeps its own catch. */
  run: Promise<T>;
  /** Ask the run to stop. Called once, before the grace window opens. */
  abort: () => void;
  /**
   * Resolves when the platform says this turn is no longer current — the heartbeat answered
   * `is_current_turn: false`. Optional: a non-session run has no such signal.
   */
  interrupted?: Promise<string>;
  limits: TurnSettleLimits;
  clock?: Clock;
  log?: (message: string) => void;
}

/**
 * Await `run`, or give up on it and say why.
 *
 * Resolves as soon as `run` settles on the happy path, with no timer left armed.
 */
export async function awaitTurnOrAbandon<T>({
  run,
  abort,
  interrupted,
  limits,
  clock = realClock,
  log = () => {},
}: AwaitTurnOptions<T>): Promise<TurnSettleOutcome<T>> {
  const timers: NodeJS.Timeout[] = [];
  const clearTimers = (): void => {
    for (const timer of timers) clock.clearTimeout(timer);
    timers.length = 0;
  };

  // A tagged sentinel, not a symbol on the value channel: `run` may resolve to anything,
  // including a symbol, and the race must be able to tell the two apart with certainty.
  type Raced =
    | { kind: "resolved"; value: T }
    | { kind: "rejected"; error: unknown }
    | { kind: "abandon" };
  const trigger: Raced = { kind: "abandon" };
  let triggerReason: string | undefined;
  const settled: Promise<Raced> = run.then(
    (value) => ({ kind: "resolved" as const, value }),
    (error) => ({ kind: "rejected" as const, error }),
  );

  try {
    const deadline = new Promise<Raced>((resolve) => {
      timers.push(
        clock.setTimeout(() => {
          triggerReason = `hard turn deadline of ${limits.hardDeadlineMs}ms exceeded`;
          resolve(trigger);
        }, limits.hardDeadlineMs),
      );
    });
    const displaced: Promise<Raced> | undefined = interrupted?.then((reason) => {
      triggerReason = reason;
      return trigger;
    });

    const first = await Promise.race(
      displaced ? [settled, deadline, displaced] : [settled, deadline],
    );
    if (first.kind === "resolved") return { settled: true, value: first.value };
    if (first.kind === "rejected") throw first.error;

    // The run must stop. Most hangs unwind from here, so ask before giving up.
    const reason = triggerReason ?? "turn abandoned";
    log(`[turn-settle] ${reason}; aborting and waiting ${limits.abandonGraceMs}ms`);
    try {
      abort();
    } catch (err) {
      log(`[turn-settle] abort threw: ${err instanceof Error ? err.message : err}`);
    }

    const grace = new Promise<Raced>((resolve) => {
      timers.push(clock.setTimeout(() => resolve(trigger), limits.abandonGraceMs));
    });
    const second = await Promise.race([settled, grace]);
    if (second.kind === "resolved") return { settled: true, value: second.value };
    if (second.kind === "rejected") throw second.error;

    log(
      `[turn-settle] run did not unwind within ${limits.abandonGraceMs}ms of the abort; ` +
        `writing the terminal outcome without it`,
    );
    return { settled: false, reason };
  } finally {
    clearTimers();
  }
}
