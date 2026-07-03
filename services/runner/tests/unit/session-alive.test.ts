/**
 * Unit tests for the runner-side alive-lock watchdog (sessions/alive.ts).
 *
 * Verifies observable behaviors via fetch interception:
 *  - the watchdog fires an immediate heartbeat on start
 *  - release() calls the heartbeat endpoint with is_running=false and status=ended
 *  - heartbeat failures are swallowed (no throw)
 */
import { describe, it, beforeEach, afterEach, vi } from "vitest";
import assert from "node:assert/strict";

const fetchCalls: Array<{ url: string; body: unknown }> = [];
let fetchShouldFail = false;

vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
  const body = init?.body ? JSON.parse(init.body as string) : undefined;
  fetchCalls.push({ url, body });
  if (fetchShouldFail) return new Response("", { status: 500 });
  return new Response(JSON.stringify({ ok: true }), { status: 200 });
});

const { startAliveWatchdog } = await import("../../src/sessions/alive.ts");

/** Flush the microtask queue so void-dispatched fetch promises settle. */
function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  fetchCalls.length = 0;
  fetchShouldFail = false;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("startAliveWatchdog", () => {
  it("sends an immediate heartbeat on start carrying turn_id and is_running=true", async () => {
    const watchdog = startAliveWatchdog("sess-1", "turn-abc", "proj-1");
    await flushMicrotasks();

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

  it("uses a stable replica_id across turns (distinct from turn_id)", async () => {
    const w1 = startAliveWatchdog("sess-a", "turn-1", "proj-1");
    await flushMicrotasks();
    const w2 = startAliveWatchdog("sess-b", "turn-2", "proj-1");
    await flushMicrotasks();

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
    const watchdog = startAliveWatchdog("sess-2", "turn-xyz", "proj-2");
    await flushMicrotasks();
    fetchCalls.length = 0; // reset after the start heartbeat

    await watchdog.release();

    const final = fetchCalls.find((c) => c.url.includes("heartbeat"));
    assert.ok(final, "expected a release heartbeat");
    const body = final.body as Record<string, unknown>;
    assert.equal(body["is_running"], false);
    assert.equal(body["turn_id"], "turn-xyz");
    assert.ok(!("status" in body), "status was dropped from the heartbeat contract");
  });

  it("swallows heartbeat failures — never throws", async () => {
    fetchShouldFail = true;
    const watchdog = startAliveWatchdog("sess-3", "run-fail", "proj-3");
    await flushMicrotasks();

    // release() should not throw even if fetch fails.
    await assert.doesNotReject(() => watchdog.release());
  });
});
