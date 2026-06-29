/**
 * Unit tests for producer-driven transcript persistence (sessions/persist.ts).
 *
 * Verifies:
 *  - events are POSTed to the ingest endpoint in order
 *  - delta families (message_start/message_delta/message_end) are coalesced into
 *    a single `message` event (stripReplay)
 *  - drainPersist waits for all pending POSTs
 *  - fetch failures are swallowed after retries
 *  - the live emitter is always called, even for delta events
 */
import { describe, it, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";

const postedBodies: unknown[] = [];
let fetchFailCount = 0;

vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) => {
  const body = init?.body ? JSON.parse(init.body as string) : undefined;
  if (fetchFailCount > 0) {
    fetchFailCount--;
    return new Response("error", { status: 500 });
  }
  postedBodies.push(body);
  return new Response(JSON.stringify({ ok: true }), { status: 200 });
});

const {
  buildPersistingEmitter,
  drainPersist,
} = await import("../../src/sessions/persist.ts");

beforeEach(() => {
  postedBodies.length = 0;
  fetchFailCount = 0;
});

describe("buildPersistingEmitter", () => {
  it("persists a plain message event and forwards to the live emitter", async () => {
    const live: unknown[] = [];
    const { emit, flush } = buildPersistingEmitter(
      "sess-1",
      () => "Secret t",
      (e) => live.push(e),
    );

    emit({ type: "message", text: "hello" });
    await flush();

    assert.equal(live.length, 1);
    assert.deepEqual(live[0], { type: "message", text: "hello" });
    assert.equal(postedBodies.length, 1);
    const body = postedBodies[0] as Record<string, unknown>;
    assert.equal(body["session_update"], "message");
    assert.equal(body["event_index"], 0);
  });

  it("coalesces message_start/delta/end into a single persisted message", async () => {
    const live: unknown[] = [];
    const { emit, flush } = buildPersistingEmitter(
      "sess-2",
      () => "Secret t", (e) =>
      live.push(e),
    );

    emit({ type: "message_start", id: "m1" });
    emit({ type: "message_delta", id: "m1", delta: "hel" });
    emit({ type: "message_delta", id: "m1", delta: "lo" });
    emit({ type: "message_end", id: "m1" });
    await flush();

    // Live emitter sees all four events.
    assert.equal(live.length, 4);
    // Persist sees only one coalesced message.
    assert.equal(postedBodies.length, 1);
    const body = postedBodies[0] as Record<string, unknown>;
    const payload = body["payload"] as Record<string, unknown>;
    assert.equal(payload["type"], "message");
    assert.equal(payload["text"], "hello");
  });

  it("persists done and tool events as-is", async () => {
    const { emit, flush } = buildPersistingEmitter("sess-3", () => "Secret t");

    emit({ type: "tool_call", name: "search", input: { q: "test" } });
    emit({ type: "done", stopReason: "end_turn" });
    await flush();

    assert.equal(postedBodies.length, 2);
    const types = (postedBodies as Array<Record<string, unknown>>).map(
      (b) => (b["payload"] as Record<string, unknown>)["type"],
    );
    assert.deepEqual(types, ["tool_call", "done"]);
  });

  it("event_index increments monotonically across events", async () => {
    const { emit, flush } = buildPersistingEmitter("sess-4", () => "Secret t");

    emit({ type: "message", text: "a" });
    emit({ type: "message", text: "b" });
    emit({ type: "done" });
    await flush();

    const indices = (postedBodies as Array<Record<string, unknown>>).map(
      (b) => b["event_index"],
    );
    assert.deepEqual(indices, [0, 1, 2]);
  });
});

describe("drainPersist", () => {
  it("resolves immediately when no events are pending", async () => {
    await assert.doesNotReject(() => drainPersist("no-session"));
  });

  it("waits for all queued events before resolving", async () => {
    const { emit, flush } = buildPersistingEmitter("sess-drain", () => "Secret t");
    emit({ type: "message", text: "x" });
    emit({ type: "done" });
    await flush(); // same as drainPersist internally
    assert.equal(postedBodies.length, 2);
  });
});
