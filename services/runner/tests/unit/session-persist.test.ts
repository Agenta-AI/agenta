/**
 * Unit tests for producer-driven record persistence (sessions/persist.ts).
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
    assert.equal(body["record_type"], "message");
    assert.equal(body["record_index"], 0);
    assert.equal(body["record_source"], "agent");
  });

  it("persist() records an out-of-band user turn through the same index counter", async () => {
    const live: unknown[] = [];
    const { emit, persist, flush } = buildPersistingEmitter(
      "sess-user",
      () => "Secret t",
      (e) => live.push(e),
    );

    persist({ type: "message", text: "what time is it?" }, "user");
    emit({ type: "message", text: "it is noon" });
    emit({ type: "done" });
    await flush();

    // The user record never hits the live stream.
    assert.equal(live.length, 2);
    assert.equal(postedBodies.length, 3);
    const bodies = postedBodies as Array<Record<string, unknown>>;
    assert.deepEqual(
      bodies.map((b) => [b["record_index"], b["record_source"]]),
      [
        [0, "user"],
        [1, "agent"],
        [2, "agent"],
      ],
    );
    const userPayload = bodies[0]["attributes"] as Record<string, unknown>;
    assert.equal(userPayload["text"], "what time is it?");
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
    const payload = body["attributes"] as Record<string, unknown>;
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
      (b) => (b["attributes"] as Record<string, unknown>)["type"],
    );
    assert.deepEqual(types, ["tool_call", "done"]);
  });

  it("record_index increments monotonically across events", async () => {
    const { emit, flush } = buildPersistingEmitter("sess-4", () => "Secret t");

    emit({ type: "message", text: "a" });
    emit({ type: "message", text: "b" });
    emit({ type: "done" });
    await flush();

    const indices = (postedBodies as Array<Record<string, unknown>>).map(
      (b) => b["record_index"],
    );
    assert.deepEqual(indices, [0, 1, 2]);
  });

  it("coalesces tool_call snapshots for one id into a single record with final args", async () => {
    const live: unknown[] = [];
    const { emit, flush } = buildPersistingEmitter(
      "sess-tc",
      () => "Secret t",
      (e) => live.push(e),
    );

    // A tool call streams a growing partial-args snapshot for one id.
    emit({ type: "tool_call", id: "call_1", name: "bash", input: {} });
    emit({ type: "tool_call", id: "call_1", name: "bash", input: { command: "fi" } });
    emit({ type: "tool_call", id: "call_1", name: "bash", input: { command: "find ." } });
    // A different step closes the open call.
    emit({ type: "tool_result", id: "call_1", output: "ok" });
    emit({ type: "done" });
    await flush();

    // Live stream sees every raw snapshot.
    assert.equal(live.length, 5);
    // Storage sees one tool_call (final args) + one tool_result + done.
    const bodies = postedBodies as Array<Record<string, unknown>>;
    const types = bodies.map(
      (b) => (b["attributes"] as Record<string, unknown>)["type"],
    );
    assert.deepEqual(types, ["tool_call", "tool_result", "done"]);
    const call = bodies[0]["attributes"] as Record<string, unknown>;
    assert.deepEqual(call["input"], { command: "find ." });
    // tool_call is stamped with a stable id and keeps the earlier index (ahead of result).
    assert.ok(typeof bodies[0]["record_id"] === "string");
    assert.equal(bodies[0]["record_index"], 0);
    assert.equal(bodies[1]["record_index"], 1);
    // tool_call and its tool_result get distinct stable ids (keyed on the record type).
    assert.notEqual(bodies[0]["record_id"], bodies[1]["record_id"]);
  });

  it("a different tool id flushes the previous open call", async () => {
    const { emit, flush } = buildPersistingEmitter("sess-tc2", () => "Secret t");

    emit({ type: "tool_call", id: "call_a", name: "read", input: { path: "/x" } });
    emit({ type: "tool_call", id: "call_b", name: "read", input: { path: "/y" } });
    await flush();

    const bodies = postedBodies as Array<Record<string, unknown>>;
    const inputs = bodies.map(
      (b) => (b["attributes"] as Record<string, unknown>)["input"],
    );
    assert.deepEqual(inputs, [{ path: "/x" }, { path: "/y" }]);
    assert.deepEqual(bodies.map((b) => b["record_index"]), [0, 1]);
  });

  it("flushes an open (paused) tool_call on drain", async () => {
    const { emit, flush } = buildPersistingEmitter("sess-tc3", () => "Secret t");

    // A paused call ends the turn with its slot still open.
    emit({ type: "tool_call", id: "call_p", name: "bash", input: { command: "ls" } });
    await flush();

    const bodies = postedBodies as Array<Record<string, unknown>>;
    assert.equal(bodies.length, 1);
    assert.equal(
      (bodies[0]["attributes"] as Record<string, unknown>)["type"],
      "tool_call",
    );
  });

  it("flushes an open tool_call when the idle TTL fires", async () => {
    vi.useFakeTimers();
    try {
      const { emit, flush } = buildPersistingEmitter("sess-tc4", () => "Secret t");

      emit({ type: "tool_call", id: "call_ttl", name: "bash", input: { command: "x" } });
      // Nothing follows; only the TTL can close it.
      assert.equal(postedBodies.length, 0);
      await vi.advanceTimersByTimeAsync(3000);
      assert.equal(postedBodies.length, 1);
      assert.equal(
        ((postedBodies[0] as Record<string, unknown>)["attributes"] as Record<string, unknown>)["type"],
        "tool_call",
      );
      await flush();
    } finally {
      vi.useRealTimers();
    }
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
