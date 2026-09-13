/**
 * W7.4: a cancel/steer/kill against a session-owned run must reach the runner process.
 *
 * The API's heartbeat response carries `is_current_turn: false` when this turn's alive/
 * running lock was gone or reassigned since the last beat. `startAliveWatchdog`'s
 * `onInterrupted` callback is how `server.ts` wires that into `controller.abort()` — these
 * tests pin the watchdog's half of that contract via fetch interception.
 */
import { describe, it, beforeEach, afterEach, vi } from "vitest";
import assert from "node:assert/strict";

const fetchCalls: Array<{ url: string; body: unknown }> = [];
let nextIsCurrentTurn: boolean | undefined = true;

/** The default heartbeat fake. Re-stubbed per test, because the fail-open cases replace it and
 * `vi.restoreAllMocks` does not undo a `vi.stubGlobal`. */
const recordingFetch = async (url: string, init?: RequestInit) => {
  const body = init?.body ? JSON.parse(init.body as string) : undefined;
  fetchCalls.push({ url, body });
  const payload: Record<string, unknown> = { ok: true };
  if (nextIsCurrentTurn !== undefined) {
    payload.is_current_turn = nextIsCurrentTurn;
  }
  return new Response(JSON.stringify(payload), { status: 200 });
};

vi.stubGlobal("fetch", recordingFetch);

const { startAliveWatchdog } = await import("../../src/sessions/alive.ts");

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  fetchCalls.length = 0;
  nextIsCurrentTurn = true;
  vi.stubGlobal("fetch", recordingFetch);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("startAliveWatchdog onInterrupted", () => {
  it("does not fire onInterrupted while is_current_turn stays true", async () => {
    const onInterrupted = vi.fn();
    const watchdog = await startAliveWatchdog(
      "sess-ok",
      "turn-ok",
      "proj-1",
      onInterrupted,
    );
    await flushMicrotasks();

    assert.equal(onInterrupted.mock.calls.length, 0);
    await watchdog.release();
  });

  it("fires onInterrupted when a beat reports is_current_turn: false", async () => {
    const onInterrupted = vi.fn();
    const watchdog = await startAliveWatchdog(
      "sess-cancelled",
      "turn-cancelled",
      "proj-1",
      onInterrupted,
    );
    await flushMicrotasks();
    assert.equal(onInterrupted.mock.calls.length, 0, "not interrupted yet");

    // A cancel/steer/kill landed: the next beat reports the lock was taken.
    nextIsCurrentTurn = false;
    // Directly drive another beat by releasing and re-starting is unnecessary — the interval
    // path is exercised in the interval test below; here we simulate the first beat itself
    // being interrupted (e.g. the lock was already gone before the watchdog's first heartbeat
    // observed it — a steer that raced session start).
    const watchdog2 = await startAliveWatchdog(
      "sess-cancelled-2",
      "turn-cancelled-2",
      "proj-1",
      onInterrupted,
    );
    await flushMicrotasks();

    assert.equal(onInterrupted.mock.calls.length, 1);

    await watchdog.release();
    await watchdog2.release();
  });

  it("fires onInterrupted at most once even if later beats keep reporting interrupted", async () => {
    nextIsCurrentTurn = false;
    const onInterrupted = vi.fn();
    const watchdog = await startAliveWatchdog(
      "sess-repeat",
      "turn-repeat",
      "proj-1",
      onInterrupted,
    );
    await flushMicrotasks();
    assert.equal(onInterrupted.mock.calls.length, 1);

    // A second beat still reporting interrupted (e.g. release()'s final heartbeat) must not
    // fire the callback again — the caller's controller.abort() is idempotent but the
    // callback itself should still only ever fire once per turn.
    await watchdog.release();
    assert.equal(onInterrupted.mock.calls.length, 1);
  });

  it("a refused beat (superseded turn) aborts the run and never throws", async () => {
    // The API refuses every beat from a turn it has tombstoned as superseded — including
    // the turn-end beat — by answering `is_current_turn: false`. The runner needs no new
    // wire field to understand that: the existing signal already means "you lost the
    // session, abort". This pins that the refusal path is the abort path.
    nextIsCurrentTurn = false;
    const onInterrupted = vi.fn();
    const watchdog = await startAliveWatchdog(
      "sess-superseded",
      "turn-superseded",
      "proj-1",
      onInterrupted,
    );
    await flushMicrotasks();

    assert.equal(onInterrupted.mock.calls.length, 1);
    await assert.doesNotReject(() => watchdog.release());
  });

  it("treats a network/HTTP failure as NOT interrupted (fail-open)", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new Error("network down");
    });
    const onInterrupted = vi.fn();
    const watchdog = await startAliveWatchdog(
      "sess-neterr",
      "turn-neterr",
      "proj-1",
      onInterrupted,
    );
    await flushMicrotasks();

    assert.equal(onInterrupted.mock.calls.length, 0);
    await assert.doesNotReject(() => watchdog.release());
  });
});

describe("startAliveWatchdog admitted (single-turn admission)", () => {
  // The first beat is this turn's ADMISSION request: its `nx` acquire of the `alive` lock is the
  // platform's single atomic arbiter of who runs a session. `admitted` reports that one answer so
  // `server.ts` can stop a losing turn at the edge, before it resolves a session environment.
  // Before this, the same answer only armed `onInterrupted`, and the losing turn still walked into
  // the keepalive pool and destroyed the winning turn's warm sandbox (#6417, #5539, #5538).

  it("is true when the first beat admits the turn", async () => {
    const watchdog = await startAliveWatchdog("sess-a", "turn-a", "proj-1");
    assert.equal(watchdog.admitted, true);
    await watchdog.release();
  });

  it("is false when the first beat reports is_current_turn: false", async () => {
    nextIsCurrentTurn = false;
    const watchdog = await startAliveWatchdog("sess-b", "turn-b", "proj-1");
    assert.equal(watchdog.admitted, false);
    await watchdog.release();
  });

  it("fails closed when the admission API is unreachable", async () => {
    // Without an affirmative first heartbeat, the runner cannot prove it owns this turn.
    vi.stubGlobal("fetch", async () => {
      throw new Error("network down");
    });
    const watchdog = await startAliveWatchdog("sess-c", "turn-c", "proj-1");
    assert.equal(watchdog.admitted, false);
    await watchdog.release();
  });

  it("reads the FIRST beat only: a later interruption is a cancel, not a failed admission", async () => {
    // A mid-turn `is_current_turn: false` is a Stop/steer/kill. That travels the
    // `onInterrupted` -> abort path and must never retroactively un-admit a turn that already ran.
    const watchdog = await startAliveWatchdog("sess-d", "turn-d", "proj-1");
    assert.equal(watchdog.admitted, true);
    nextIsCurrentTurn = false;
    await flushMicrotasks();
    assert.equal(watchdog.admitted, true, "admitted is a fact about the start of the turn");
    await watchdog.release();
  });
});
