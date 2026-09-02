/**
 * A turn must reach exactly one terminal outcome, even when `run()` never returns.
 *
 * The runner writes its terminal record, and releases the alive watchdog, downstream of
 * `await run(...)`. A run that never settles therefore leaves the session announcing
 * `running=true` every thirty seconds with no ending ever written — issue #6418, and the shape
 * behind #6100 and #5327 too. `awaitTurnOrAbandon` bounds that wait.
 *
 * The contract these tests hold: the happy path is untouched and leaves no timer armed; giving
 * up always tries an abort FIRST, because most hangs unwind from one; and the caller is only
 * told to write its own ending when the run is genuinely still pending afterwards.
 */

import { describe, it, expect, vi, afterEach } from "vitest";

import {
  ABANDON_GRACE_ENV,
  DEFAULT_ABANDON_GRACE_MS,
  DEFAULT_HARD_DEADLINE_MS,
  HARD_DEADLINE_ENV,
  awaitTurnOrAbandon,
  resolveTurnSettleLimits,
  type Clock,
  type TurnSettleLimits,
} from "../../src/sessions/turn-settle.ts";
import { DEFAULT_TOTAL_DEADLINE_MS } from "../../src/engines/sandbox_agent/run-limits.ts";

function fakeClock(): Clock & { fireAll(): Promise<void>; pending(): number } {
  let nextId = 1;
  const timers = new Map<number, () => void>();
  return {
    setTimeout(fn: () => void) {
      const id = nextId++;
      timers.set(id, fn);
      return id as unknown as NodeJS.Timeout;
    },
    clearTimeout(handle: NodeJS.Timeout) {
      timers.delete(handle as unknown as number);
    },
    pending: () => timers.size,
    async fireAll() {
      for (const [id, fn] of [...timers.entries()]) {
        timers.delete(id);
        fn();
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
  };
}

const limits: TurnSettleLimits = {
  hardDeadlineMs: 10_000,
  abandonGraceMs: 1_000,
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("awaitTurnOrAbandon", () => {
  it("returns the run's own result and leaves no timer armed", async () => {
    const clock = fakeClock();
    const abort = vi.fn();

    const outcome = await awaitTurnOrAbandon({
      run: Promise.resolve({ ok: true }),
      abort,
      limits,
      clock,
    });

    expect(outcome).toEqual({ settled: true, value: { ok: true } });
    expect(abort).not.toHaveBeenCalled();
    expect(clock.pending()).toBe(0);
  });

  it("rethrows a run that rejects, so the caller's own catch still owns the error", async () => {
    const clock = fakeClock();

    await expect(
      awaitTurnOrAbandon({
        run: Promise.reject(new Error("harness blew up")),
        abort: vi.fn(),
        limits,
        clock,
      }),
    ).rejects.toThrow("harness blew up");
    expect(clock.pending()).toBe(0);
  });

  it("aborts first when the platform says the turn is no longer current", async () => {
    const clock = fakeClock();
    let finishRun: ((value: unknown) => void) | undefined;
    const run = new Promise((resolve) => {
      finishRun = resolve;
    });
    // The real run unwinds from its abort; model that.
    const abort = vi.fn(() => finishRun?.({ ok: false, error: "cancelled" }));

    const settling = awaitTurnOrAbandon({
      run,
      abort,
      interrupted: Promise.resolve("stopped by the user"),
      limits,
      clock,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(abort).toHaveBeenCalledTimes(1);
    await expect(settling).resolves.toEqual({
      settled: true,
      value: { ok: false, error: "cancelled" },
    });
    expect(clock.pending()).toBe(0);
  });

  it("gives up and hands the caller a reason when the run will not unwind", async () => {
    const clock = fakeClock();
    // The wedged case: aborting changes nothing, because the pending ACP request cannot settle.
    const run = new Promise(() => {});
    const abort = vi.fn();

    const settling = awaitTurnOrAbandon({
      run,
      abort,
      interrupted: Promise.resolve("declared lost by the platform"),
      limits,
      clock,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(abort).toHaveBeenCalledTimes(1);
    await clock.fireAll(); // the grace window closes

    await expect(settling).resolves.toEqual({
      settled: false,
      reason: "declared lost by the platform",
    });
    expect(clock.pending()).toBe(0);
  });

  it("gives up on the hard deadline even with no interruption signal at all", async () => {
    const clock = fakeClock();
    const settling = awaitTurnOrAbandon({
      run: new Promise(() => {}),
      abort: vi.fn(),
      limits,
      clock,
    });

    await clock.fireAll(); // the hard deadline
    await clock.fireAll(); // the grace window

    const outcome = await settling;
    expect(outcome.settled).toBe(false);
    if (outcome.settled) return;
    expect(outcome.reason).toContain("hard turn deadline");
  });

  it("survives an abort that throws", async () => {
    const clock = fakeClock();
    const settling = awaitTurnOrAbandon({
      run: new Promise(() => {}),
      abort: () => {
        throw new Error("controller already closed");
      },
      interrupted: Promise.resolve("lost"),
      limits,
      clock,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await clock.fireAll();

    await expect(settling).resolves.toEqual({ settled: false, reason: "lost" });
  });
});

describe("turn settle limits", () => {
  it("keeps the hard deadline above the longest legitimate run", () => {
    // A backstop that fired before the run limits would shorten real runs, which is the
    // opposite of what users have asked for (issues #6084, #5356).
    expect(DEFAULT_HARD_DEADLINE_MS).toBeGreaterThan(DEFAULT_TOTAL_DEADLINE_MS);
    expect(resolveTurnSettleLimits()).toEqual({
      hardDeadlineMs: DEFAULT_HARD_DEADLINE_MS,
      abandonGraceMs: DEFAULT_ABANDON_GRACE_MS,
    });
  });

  it("takes an operator override", () => {
    vi.stubEnv(HARD_DEADLINE_ENV, "120000");
    vi.stubEnv(ABANDON_GRACE_ENV, "5000");

    expect(resolveTurnSettleLimits()).toEqual({
      hardDeadlineMs: 120_000,
      abandonGraceMs: 5_000,
    });
  });
});
