/**
 * Unit tests for the time-based run-limit engine (total/idle/TTFB/per-tool-call deadlines).
 *
 * A fake, manually-advanced clock stands in for real timers so every test is instant and
 * deterministic (see `fakeClock()` below) — no test waits on a real setTimeout.
 *
 * Run: pnpm test (or: pnpm exec vitest run tests/unit/run-limits.test.ts)
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";

import {
  createRunLimits,
  resolveRunLimits,
  runWithTurnLimit,
  DEFAULT_IDLE_TIMEOUT_MS,
  DEFAULT_TOTAL_DEADLINE_MS,
  DEFAULT_TTFB_TIMEOUT_MS,
  DEFAULT_TOOL_CALL_TIMEOUT_MS,
  TOTAL_DEADLINE_ENV,
  IDLE_TIMEOUT_ENV,
  TTFB_TIMEOUT_ENV,
  TOOL_CALL_TIMEOUT_ENV,
  TOOL_CALL_GRACE_MS,
  commandTimeoutSeconds,
  type Clock,
  type RunLimitKind,
} from "../../src/engines/sandbox_agent/run-limits.ts";

/** A manually-advanced fake clock: `advance(ms)` fires every timer now due, in schedule order. */
function fakeClock() {
  let now = 0;
  let nextId = 1;
  const pending = new Map<number, { at: number; fn: () => void }>();
  const clock: Clock = {
    now: () => now,
    setTimeout: (fn, ms) => {
      const id = nextId++;
      pending.set(id, { at: now + ms, fn });
      return id as unknown as NodeJS.Timeout;
    },
    clearTimeout: (handle) => {
      pending.delete(handle as unknown as number);
    },
  };
  const advance = (ms: number): void => {
    now += ms;
    for (const [id, entry] of [...pending.entries()].sort(
      (a, b) => a[1].at - b[1].at,
    )) {
      if (entry.at <= now && pending.has(id)) {
        pending.delete(id);
        entry.fn();
      }
    }
  };
  return { clock, advance, pendingCount: () => pending.size };
}

const envKeys = [
  TOTAL_DEADLINE_ENV,
  IDLE_TIMEOUT_ENV,
  TTFB_TIMEOUT_ENV,
  TOOL_CALL_TIMEOUT_ENV,
];

function withEnv(overrides: Record<string, string | undefined>, fn: () => void): void {
  const previous = new Map<string, string | undefined>();
  for (const key of envKeys) previous.set(key, process.env[key]);
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    fn();
  } finally {
    for (const key of envKeys) {
      const value = previous.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

describe("resolveRunLimits", () => {
  it("defaults every limit wide with idle strictly under total", () => {
    withEnv(
      {
        [TOTAL_DEADLINE_ENV]: undefined,
        [IDLE_TIMEOUT_ENV]: undefined,
        [TTFB_TIMEOUT_ENV]: undefined,
        [TOOL_CALL_TIMEOUT_ENV]: undefined,
      },
      () => {
        const limits = resolveRunLimits();
        assert.equal(limits.totalMs, DEFAULT_TOTAL_DEADLINE_MS);
        assert.equal(limits.idleMs, DEFAULT_IDLE_TIMEOUT_MS);
        assert.equal(limits.ttfbMs, DEFAULT_TTFB_TIMEOUT_MS);
        assert.equal(limits.toolCallMs, DEFAULT_TOOL_CALL_TIMEOUT_MS);
        assert.ok(limits.idleMs < limits.totalMs);
        assert.ok(
          limits.totalMs > 45 * 60_000,
          "the default total deadline must not reap legitimate runs at the former 45-minute cutoff",
        );
      },
    );
  });

  it("honors env overrides for every limit", () => {
    withEnv(
      {
        [TOTAL_DEADLINE_ENV]: "1000000",
        [IDLE_TIMEOUT_ENV]: "100000",
        [TTFB_TIMEOUT_ENV]: "5000",
        [TOOL_CALL_TIMEOUT_ENV]: "200000",
      },
      () => {
        const limits = resolveRunLimits();
        assert.equal(limits.totalMs, 1000000);
        assert.equal(limits.idleMs, 100000);
        assert.equal(limits.ttfbMs, 5000);
        assert.equal(limits.toolCallMs, 200000);
      },
    );
  });

  it("clamps idle below total instead of leaving idle unreachable when misconfigured", () => {
    withEnv(
      {
        [TOTAL_DEADLINE_ENV]: "60000",
        [IDLE_TIMEOUT_ENV]: "90000", // idle > total: must not survive as-is
      },
      () => {
        const limits = resolveRunLimits();
        assert.ok(limits.idleMs < limits.totalMs);
        assert.equal(limits.idleMs, 30000); // clamped to half of total
      },
    );
  });

  it("the plan's turn limit shortens the total deadline and carries its message", () => {
    withEnv({ [TOTAL_DEADLINE_ENV]: undefined, [IDLE_TIMEOUT_ENV]: undefined }, () => {
      const limits = resolveRunLimits(() => {}, { ms: 30 * 60_000, message: "Stopped at 30 minutes." });
      assert.equal(limits.totalMs, 30 * 60_000);
      assert.equal(limits.turnLimitMessage, "Stopped at 30 minutes.");
      // Idle equal to a plan's short turn is not a misconfiguration: the total fires first.
      assert.equal(limits.idleMs, DEFAULT_IDLE_TIMEOUT_MS);
    });
  });

  it("an operator's lower env deadline wins over the plan, and no plan means the env alone", () => {
    withEnv({ [TOTAL_DEADLINE_ENV]: "60000", [IDLE_TIMEOUT_ENV]: "10000" }, () => {
      const limits = resolveRunLimits(() => {}, { ms: 4 * 60 * 60_000, message: "Stopped at 4 hours." });
      assert.equal(limits.totalMs, 60000);
      assert.equal(limits.turnLimitMessage, undefined);
    });
    withEnv({ [TOTAL_DEADLINE_ENV]: undefined }, () => {
      const limits = resolveRunLimits(() => {}, undefined);
      assert.equal(limits.totalMs, DEFAULT_TOTAL_DEADLINE_MS);
      assert.equal(limits.turnLimitMessage, undefined);
    });
  });

  it("reads the turn limit in scope for the run that resolves it", () => {
    withEnv({ [TOTAL_DEADLINE_ENV]: undefined }, () => {
      const inside = runWithTurnLimit({ ms: 1_800_000, message: "Stopped." }, () => resolveRunLimits());
      assert.ok(inside.totalMs <= 1_800_000 && inside.totalMs > 1_790_000);
      assert.equal(resolveRunLimits().totalMs, DEFAULT_TOTAL_DEADLINE_MS);
    });
  });

  it("a later attempt in the same admitted turn gets only the time left", () => {
    const realNow = Date.now;
    let now = 1_000_000;
    Date.now = () => now;
    try {
      withEnv({ [TOTAL_DEADLINE_ENV]: undefined }, () => {
        const totals = runWithTurnLimit({ ms: 1_800_000, message: "Stopped." }, () => {
          const first = resolveRunLimits().totalMs;
          now += 120_000; // the first attempt stalled for two minutes and is retried
          const retry = resolveRunLimits().totalMs;
          now += 1_800_000; // a retry that starts past the limit trips at once
          const late = resolveRunLimits();
          return [first, retry, late.totalMs, late.turnLimitMessage];
        });
        assert.deepEqual(totals, [1_800_000, 1_680_000, 1, "Stopped."]);
      });
    } finally {
      Date.now = realNow;
    }
  });

  it("a degenerate total cannot derive an idle timeout that fires instantly", () => {
    // A total at the timer floor makes "half the total" round to 0; every field must still
    // leave here armable, since createRunLimits feeds all four straight to setTimeout.
    withEnv({ [TOTAL_DEADLINE_ENV]: "0.5" }, () => {
      const limits = resolveRunLimits();
      for (const [name, ms] of Object.entries(limits)) {
        assert.ok(Number.isInteger(ms) && ms >= 1, `${name}=${ms} is not an armable delay`);
      }
    });
  });
});

describe("createRunLimits", () => {
  it("does not trip a progressing default run at the former 45-minute cutoff", () => {
    const { clock, advance } = fakeClock();
    let resolved!: ReturnType<typeof resolveRunLimits>;
    withEnv({ [TOTAL_DEADLINE_ENV]: undefined }, () => {
      resolved = resolveRunLimits();
    });
    const limits = createRunLimits(resolved, { clock });
    const trips: string[] = [];
    limits.onTrip((reason) => trips.push(reason));

    for (let elapsed = 0; elapsed <= 45 * 60_000; elapsed += 60_000) {
      advance(60_000);
      limits.noteProgress();
    }

    assert.deepEqual(trips, []);
  });

  it("trips the total deadline and reports the reason exactly once", () => {
    const { clock, advance } = fakeClock();
    const limits = createRunLimits(
      { totalMs: 1000, idleMs: 500, ttfbMs: 2000, toolCallMs: 2000 },
      { clock },
    );
    const trips: string[] = [];
    const kinds: string[] = [];
    limits.onTrip((reason, kind) => {
      trips.push(reason);
      kinds.push(kind);
    });

    advance(999);
    assert.equal(trips.length, 0, "must not trip before the deadline");
    advance(2);
    assert.equal(trips.length, 1);
    assert.match(trips[0], /total run deadline/);
    assert.deepEqual(kinds, ["total"]);

    // Idempotent: nothing else should fire after the first trip (timers were cleared).
    advance(100000);
    assert.equal(trips.length, 1);
  });

  it("trips idle only after no progress for the idle window, resetting on each progress signal", () => {
    const { clock, advance } = fakeClock();
    const limits = createRunLimits(
      { totalMs: 100000, idleMs: 1000, ttfbMs: 100000, toolCallMs: 100000 },
      { clock },
    );
    const trips: string[] = [];
    limits.onTrip((reason) => trips.push(reason));

    // Progress every 900ms keeps pushing the idle deadline out, so it never fires.
    for (let i = 0; i < 5; i++) {
      advance(900);
      limits.noteProgress();
    }
    assert.equal(trips.length, 0, "idle must reset on each progress signal");

    // Now stop making progress: the idle window elapses uninterrupted.
    advance(1000);
    assert.equal(trips.length, 1);
    assert.match(trips[0], /idle timeout/);
  });

  it("trips TTFB when no event arrives before the first-response window, and cancels TTFB once one does", () => {
    const { clock, advance } = fakeClock();
    const limits = createRunLimits(
      { totalMs: 100000, idleMs: 100000, ttfbMs: 1000, toolCallMs: 100000 },
      { clock },
    );
    const trips: string[] = [];
    limits.onTrip((reason) => trips.push(reason));

    advance(1000);
    assert.equal(trips.length, 1);
    assert.match(trips[0], /first response/);
  });

  it("does not trip TTFB once the first progress event arrives before the window elapses", () => {
    const { clock, advance } = fakeClock();
    const limits = createRunLimits(
      { totalMs: 100000, idleMs: 100000, ttfbMs: 1000, toolCallMs: 100000 },
      { clock },
    );
    const trips: string[] = [];
    limits.onTrip((reason) => trips.push(reason));

    advance(500);
    limits.noteProgress();
    advance(600); // would have tripped TTFB at 1000ms if not cancelled by the event above
    assert.equal(trips.length, 0);
  });

  it("trips a per-tool-call timeout for a hung tool call without affecting a sibling", () => {
    const { clock, advance } = fakeClock();
    const limits = createRunLimits(
      { totalMs: 100000, idleMs: 100000, ttfbMs: 100000, toolCallMs: 1000 },
      { clock },
    );
    const trips: string[] = [];
    limits.onTrip((reason) => trips.push(reason));

    limits.noteToolCallStart("call-1");
    advance(500);
    limits.noteToolCallStart("call-2"); // a second, independent call
    advance(400);
    limits.noteToolCallEnd("call-2"); // call-2 finishes in time
    assert.equal(trips.length, 0);

    advance(600); // call-1 has now been open 1500ms > 1000ms
    assert.equal(trips.length, 1);
    assert.match(trips[0], /tool call call-1/);
  });

  it("does not trip a tool call that ends before its own deadline", () => {
    const { clock, advance } = fakeClock();
    const limits = createRunLimits(
      { totalMs: 100000, idleMs: 100000, ttfbMs: 100000, toolCallMs: 1000 },
      { clock },
    );
    const trips: string[] = [];
    limits.onTrip((reason) => trips.push(reason));

    limits.noteToolCallStart("call-1");
    advance(900);
    limits.noteToolCallEnd("call-1");
    advance(1000); // long past the original deadline, but the call already ended
    assert.equal(trips.length, 0);
  });

  it("a paused turn is never reaped by idle, total, or an in-flight tool-call timer", () => {
    const { clock, advance } = fakeClock();
    const limits = createRunLimits(
      { totalMs: 2000, idleMs: 500, ttfbMs: 2000, toolCallMs: 500 },
      { clock },
    );
    const trips: string[] = [];
    limits.onTrip((reason) => trips.push(reason));

    limits.noteToolCallStart("paused-call");
    advance(100);
    limits.notePaused(); // the turn parks for human input before any deadline elapses

    // Every window that would otherwise fire elapses many times over.
    advance(1_000_000);
    assert.equal(
      trips.length,
      0,
      "a paused turn must never trip total/idle/per-tool-call deadlines",
    );
  });

  it("dispose() is safe to call on every path and prevents any later trip", () => {
    const { clock, advance } = fakeClock();
    const limits = createRunLimits(
      { totalMs: 1000, idleMs: 500, ttfbMs: 1000, toolCallMs: 1000 },
      { clock },
    );
    const trips: string[] = [];
    limits.onTrip((reason) => trips.push(reason));

    limits.dispose();
    advance(1_000_000);
    assert.equal(trips.length, 0);

    // Calling dispose again (e.g. from a finally after an earlier explicit dispose) must not throw.
    assert.doesNotThrow(() => limits.dispose());
  });

  /*
   * The trip KIND is what lets the dispatch re-prompt a stalled turn (`runAgent` in `server.ts`).
   * Only `ttfb` may be retried, because only `ttfb` proves the turn emitted nothing, so these pin
   * that each limit reports its own kind and that `ttfb` cannot be reported once work has landed.
   */
  it("reports which limit tripped", () => {
    const kindOf = (
      limits: Parameters<typeof createRunLimits>[0],
      act: (handle: ReturnType<typeof createRunLimits>, advance: (ms: number) => void) => void,
    ): RunLimitKind | undefined => {
      const { clock, advance } = fakeClock();
      const handle = createRunLimits(limits, { clock });
      let kind: RunLimitKind | undefined;
      handle.onTrip((_reason, tripped) => {
        kind = tripped;
      });
      act(handle, advance);
      return kind;
    };

    assert.equal(
      kindOf({ totalMs: 1000, idleMs: 900, ttfbMs: 5000, toolCallMs: 5000 }, (_h, advance) =>
        advance(1001),
      ),
      "total",
    );
    assert.equal(
      kindOf({ totalMs: 100000, idleMs: 1000, ttfbMs: 100000, toolCallMs: 100000 }, (h, advance) => {
        h.noteProgress();
        advance(1001);
      }),
      "idle",
    );
    assert.equal(
      kindOf({ totalMs: 100000, idleMs: 50000, ttfbMs: 1000, toolCallMs: 100000 }, (_h, advance) =>
        advance(1001),
      ),
      "ttfb",
    );
    assert.equal(
      kindOf({ totalMs: 100000, idleMs: 50000, ttfbMs: 50000, toolCallMs: 1000 }, (h, advance) => {
        h.noteToolCallStart("call-1");
        advance(1001);
      }),
      "tool-call",
    );
  });

  it("never reports ttfb once the turn has emitted anything", () => {
    const { clock, advance } = fakeClock();
    const limits = createRunLimits(
      { totalMs: 100000, idleMs: 1000, ttfbMs: 1200, toolCallMs: 100000 },
      { clock },
    );
    const kinds: (RunLimitKind | undefined)[] = [];
    limits.onTrip((_reason, kind) => kinds.push(kind));

    // One event lands, then the run goes quiet for longer than BOTH windows. The idle limit is
    // what may fire; reporting `ttfb` here would tell the dispatch nothing ran when something did,
    // and the retry would replay work the harness had already begun.
    advance(500);
    limits.noteProgress();
    advance(5000);

    assert.deepEqual(kinds, ["idle"]);
  });
});

describe("a slow tool call is stopped by its command, not by the turn (EU 2026-10-06)", () => {
  // A `bash` call ran past the 300 s tool-call limit and the watchdog ended the whole turn. The
  // command is now stopped at the limit, so the watchdog waits a grace for that result first.
  it("gives a command the tool-call limit as its timeout, never more, whatever the model asked", () => {
    assert.equal(commandTimeoutSeconds(undefined, 300_000), 300);
    assert.equal(commandTimeoutSeconds(600, 300_000), 300);
    assert.equal(commandTimeoutSeconds(20, 300_000), 20);
    assert.equal(commandTimeoutSeconds(0, 300_000), 300);
    assert.equal(commandTimeoutSeconds(undefined, 500), 1);
  });

  it("reads the command timeout from AGENTA_RUNNER_TOOL_CALL_TIMEOUT_MS", () => {
    withEnv({ [TOOL_CALL_TIMEOUT_ENV]: "20000" }, () => {
      assert.equal(commandTimeoutSeconds(undefined), 20);
      assert.equal(resolveRunLimits().toolCallGraceMs, TOOL_CALL_GRACE_MS);
    });
  });

  it("lets a tool call whose result arrives within the grace end normally", () => {
    const { clock, advance } = fakeClock();
    const limits = createRunLimits(
      { totalMs: 1e7, idleMs: 1e7, ttfbMs: 1e7, toolCallMs: 1000, toolCallGraceMs: 500 },
      { clock },
    );
    const trips: string[] = [];
    limits.onTrip((reason) => trips.push(reason));
    limits.noteToolCallStart("call-1");
    advance(1200); // past the limit: the command was stopped and its result is on its way
    assert.equal(trips.length, 0);
    limits.noteToolCallEnd("call-1");
    advance(10_000);
    assert.equal(trips.length, 0);
  });

  it("still ends the turn over a hung tool call once the grace is spent", () => {
    const { clock, advance } = fakeClock();
    const limits = createRunLimits(
      { totalMs: 1e7, idleMs: 1e7, ttfbMs: 1e7, toolCallMs: 1000, toolCallGraceMs: 500 },
      { clock },
    );
    const trips: Array<[string, RunLimitKind]> = [];
    limits.onTrip((reason, kind) => trips.push([reason, kind]));
    limits.noteToolCallStart("call-hung");
    advance(1499);
    assert.equal(trips.length, 0);
    advance(1);
    assert.equal(trips.length, 1);
    assert.equal(trips[0]![1], "tool-call");
    assert.match(trips[0]![0], /tool call call-hung exceeded 1000ms and returned no result within 500ms more/);
  });
});
