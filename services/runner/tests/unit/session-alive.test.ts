/**
 * Unit tests for the runner-side alive-lock watchdog (sessions/alive.ts).
 *
 * Verifies observable behaviors via fetch interception:
 *  - the watchdog fires an immediate heartbeat on start
 *  - the FIRST heartbeat's response `stream.id` is captured and exposed via `streamId()`
 *  - release() calls the heartbeat endpoint with is_running=false and status=ended
 *  - heartbeat failures are swallowed (no throw), and `streamId()` stays undefined
 */
import { describe, it, beforeEach, afterEach, vi } from "vitest";
import assert from "node:assert/strict";

const fetchCalls: Array<{ url: string; body: unknown }> = [];
let fetchShouldFail = false;
let streamIdToReturn: string | undefined = "stream-default";

vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
  const body = init?.body ? JSON.parse(init.body as string) : undefined;
  fetchCalls.push({ url, body });
  if (fetchShouldFail) return new Response("", { status: 500 });
  return new Response(
    JSON.stringify({
      ok: true,
      stream: streamIdToReturn ? { id: streamIdToReturn } : undefined,
    }),
    { status: 200 },
  );
});

const { startAliveWatchdog } = await import("../../src/sessions/alive.ts");

/** Flush the microtask queue so void-dispatched fetch promises settle. */
function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  fetchCalls.length = 0;
  fetchShouldFail = false;
  streamIdToReturn = "stream-default";
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("startAliveWatchdog", () => {
  it("sends an immediate heartbeat on start carrying turn_id and is_running=true", async () => {
    const watchdog = await startAliveWatchdog("sess-1", "turn-abc", "proj-1");

    const hb = fetchCalls.find((c) => c.url.includes("heartbeat"));
    assert.ok(hb, "expected a heartbeat call");
    const body = hb.body as Record<string, unknown>;
    assert.equal(body["is_running"], true);
    assert.equal(body["session_id"], "sess-1");
    assert.equal(body["turn_id"], "turn-abc");
    // replica_id is the stable container id — distinct from the turn id, not "turn-abc".
    assert.ok(body["replica_id"], "expected a replica_id");
    assert.notEqual(body["replica_id"], "turn-abc");

    await watchdog.release();
  });

  it("captures stream_id from the first heartbeat's response — no extra round-trip", async () => {
    streamIdToReturn = "stream-xyz";
    const watchdog = await startAliveWatchdog("sess-1", "turn-abc", "proj-1");

    assert.equal(watchdog.streamId(), "stream-xyz");
    // Exactly one heartbeat call was needed to obtain it.
    const heartbeats = fetchCalls.filter((c) => c.url.includes("heartbeat"));
    assert.equal(heartbeats.length, 1);

    await watchdog.release();
  });

  it("streamId() is undefined when the heartbeat response carries no stream", async () => {
    streamIdToReturn = undefined;
    const watchdog = await startAliveWatchdog("sess-1", "turn-abc", "proj-1");
    assert.equal(watchdog.streamId(), undefined);
    await watchdog.release();
  });

  it("streamId() is undefined when the first heartbeat fails", async () => {
    fetchShouldFail = true;
    const watchdog = await startAliveWatchdog("sess-1", "turn-abc", "proj-1");
    assert.equal(watchdog.streamId(), undefined);
    await watchdog.release();
  });

  it("uses a stable replica_id across turns (distinct from turn_id)", async () => {
    const w1 = await startAliveWatchdog("sess-a", "turn-1", "proj-1");
    const w2 = await startAliveWatchdog("sess-b", "turn-2", "proj-1");

    const replicas = fetchCalls
      .filter((c) => c.url.includes("heartbeat"))
      .map((c) => (c.body as Record<string, unknown>)["replica_id"]);
    assert.ok(replicas.length >= 2);
    // Same process → same replica_id for both turns.
    assert.equal(replicas[0], replicas[1]);

    await w1.release();
    await w2.release();
  });

  it("release() sends a final heartbeat with is_running=false (status derived server-side)", async () => {
    const watchdog = await startAliveWatchdog("sess-2", "turn-xyz", "proj-2");
    fetchCalls.length = 0; // reset after the start heartbeat

    await watchdog.release();

    const final = fetchCalls.find((c) => c.url.includes("heartbeat"));
    assert.ok(final, "expected a release heartbeat");
    const body = final.body as Record<string, unknown>;
    assert.equal(body["is_running"], false);
    assert.equal(body["turn_id"], "turn-xyz");
    assert.ok(
      !("status" in body),
      "status was dropped from the heartbeat contract",
    );
  });

  it("sends no further heartbeats after release() — the zombie-beat source", async () => {
    // A turn that ended or parked must stop beating. A beat that outlives its turn is what
    // the API's supersession tombstone exists to refuse (approvals plan §6): it would
    // otherwise find the parked holder's `alive` with no `running` and take the whole nest,
    // making the user's approval resume look superseded. Stopping the interval BEFORE the
    // final beat is the runner's half of that contract.
    vi.useFakeTimers();
    try {
      const watchdog = await startAliveWatchdog(
        "sess-parked",
        "turn-parked",
        "proj-1",
      );
      await watchdog.release();
      const afterRelease = fetchCalls.filter((c) =>
        c.url.includes("heartbeat"),
      ).length;

      await vi.advanceTimersByTimeAsync(5 * 30_000);

      assert.equal(
        fetchCalls.filter((c) => c.url.includes("heartbeat")).length,
        afterRelease,
        "a released turn kept heartbeating: every one of those beats is a zombie",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("release()'s final beat is the turn-end signal: is_running=false under this turn's id", async () => {
    // The API keys the whole nest handover on this pair. If the id drifted, the turn-end
    // beat would clear a DIFFERENT turn's `running`.
    const watchdog = await startAliveWatchdog("sess-end", "turn-end", "proj-1");
    fetchCalls.length = 0;

    await watchdog.release();

    const beats = fetchCalls.filter((c) => c.url.includes("heartbeat"));
    assert.equal(beats.length, 1, "exactly one turn-end beat");
    const body = beats[0].body as Record<string, unknown>;
    assert.equal(body["is_running"], false);
    assert.equal(body["turn_id"], "turn-end");
    assert.equal(body["session_id"], "sess-end");
  });

  it("swallows heartbeat failures — never throws", async () => {
    fetchShouldFail = true;
    const watchdog = await startAliveWatchdog("sess-3", "run-fail", "proj-3");

    // release() should not throw even if fetch fails.
    await assert.doesNotReject(() => watchdog.release());
  });

  it("a later heartbeat updates streamId() when it returns a fresh id", async () => {
    vi.useFakeTimers();
    try {
      streamIdToReturn = "stream-first";
      const watchdog = await startAliveWatchdog("sess-1", "turn-abc", "proj-1");
      assert.equal(watchdog.streamId(), "stream-first");

      streamIdToReturn = "stream-second";
      await vi.advanceTimersByTimeAsync(30_000);
      assert.equal(watchdog.streamId(), "stream-second");

      await watchdog.release();
    } finally {
      vi.useRealTimers();
    }
  });
});
