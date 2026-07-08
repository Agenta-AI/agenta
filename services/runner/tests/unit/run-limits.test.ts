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
  DEFAULT_IDLE_TIMEOUT_MS,
  DEFAULT_TOTAL_DEADLINE_MS,
  DEFAULT_TTFB_TIMEOUT_MS,
  DEFAULT_TOOL_CALL_TIMEOUT_MS,
  TOTAL_DEADLINE_ENV,
  IDLE_TIMEOUT_ENV,
  TTFB_TIMEOUT_ENV,
  TOOL_CALL_TIMEOUT_ENV,
  type Clock,
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
});

describe("createRunLimits", () => {
  it("trips the total deadline and reports the reason exactly once", () => {
    const { clock, advance } = fakeClock();
    const limits = createRunLimits(
      { totalMs: 1000, idleMs: 500, ttfbMs: 2000, toolCallMs: 2000 },
      { clock },
    );
    const trips: string[] = [];
    limits.onTrip((reason) => trips.push(reason));

    advance(999);
    assert.equal(trips.length, 0, "must not trip before the deadline");
    advance(2);
    assert.equal(trips.length, 1);
    assert.match(trips[0], /total run deadline/);

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
    const emit = limits.wrapEmit(() => {});

    // Progress every 900ms keeps pushing the idle deadline out, so it never fires.
    for (let i = 0; i < 5; i++) {
      advance(900);
      emit({ type: "message_delta", id: "m1", delta: "x" });
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
    const emit = limits.wrapEmit(() => {});

    advance(500);
    emit({ type: "message_delta", id: "m1", delta: "x" });
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
});
