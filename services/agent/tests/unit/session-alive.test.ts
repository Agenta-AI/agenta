/**
 * Unit tests for the runner-side alive-lock watchdog (sessions/alive.ts).
 *
 * Verifies observable behaviors via fetch interception:
 *  - the watchdog fires an immediate heartbeat on start
 *  - release() calls the heartbeat endpoint with sandbox_live=false and status=ended
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
  it("sends an immediate heartbeat on start with sandbox_live=true", async () => {
    const watchdog = startAliveWatchdog("sess-1", "run-abc", "proj-1");
    await flushMicrotasks();

    const hb = fetchCalls.find((c) => c.url.includes("heartbeat"));
    assert.ok(hb, "expected a heartbeat call");
    const body = hb.body as Record<string, unknown>;
    assert.equal(body["sandbox_live"], true);
    assert.equal(body["session_id"], "sess-1");
    assert.equal(body["replica_id"], "run-abc");

    await watchdog.release();
  });

  it("release() sends a final heartbeat with sandbox_live=false and status=ended", async () => {
    const watchdog = startAliveWatchdog("sess-2", "run-xyz", "proj-2");
    await flushMicrotasks();
    fetchCalls.length = 0; // reset after the start heartbeat

    await watchdog.release();

    const final = fetchCalls.find((c) => c.url.includes("heartbeat"));
    assert.ok(final, "expected a release heartbeat");
    const body = final.body as Record<string, unknown>;
    assert.equal(body["sandbox_live"], false);
    assert.deepEqual(body["status"], { code: "ended" });
  });

  it("swallows heartbeat failures — never throws", async () => {
    fetchShouldFail = true;
    const watchdog = startAliveWatchdog("sess-3", "run-fail", "proj-3");
    await flushMicrotasks();

    // release() should not throw even if fetch fails.
    await assert.doesNotReject(() => watchdog.release());
  });
});
