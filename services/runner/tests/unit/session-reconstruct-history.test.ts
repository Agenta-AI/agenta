/**
 * Unit tests for the reconstruction seam (reconstruct-history.ts).
 *
 * The safety contract: the flag is ON by default (only the literal "false" disables it), and
 * reconstruction is a strict no-op until BOTH the flag is on AND the client sent a minimal
 * history. Anything else leaves the inbound history untouched (returns null).
 */
import { describe, it, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";

let fetchCalls = 0;
let recordsToReturn: unknown[] = [];
let fetchShouldFail = false;

vi.stubGlobal("fetch", async () => {
  fetchCalls++;
  if (fetchShouldFail) return new Response("err", { status: 500 });
  return new Response(JSON.stringify({ records: recordsToReturn }), { status: 200 });
});

const { reconstructHistoryIfNeeded } = await import(
  "../../src/engines/sandbox_agent/reconstruct-history.ts"
);
const { noteRecordsIncomplete } = await import("../../src/sessions/persist.ts");

const auth = () => "Secret t";
const userTurn = { role: "user", content: "hi again" };

beforeEach(() => {
  fetchCalls = 0;
  recordsToReturn = [];
  fetchShouldFail = false;
  vi.unstubAllEnvs();
  // The hermetic setup pins the flag off for the engine suites; this file tests the real
  // default, so drop the pin (absent = on).
  delete process.env.AGENTA_SESSIONS_RECONSTRUCT;
});

describe("reconstructHistoryIfNeeded", () => {
  it('no-op when the flag is explicitly "false" (never even queries)', async () => {
    vi.stubEnv("AGENTA_SESSIONS_RECONSTRUCT", "false");
    const req = { messages: [userTurn] } as never;
    const out = await reconstructHistoryIfNeeded(req, "sess-1", auth);
    assert.equal(out, null);
    assert.equal(fetchCalls, 0);
  });

  it("on by default: an absent flag reconstructs a minimal history", async () => {
    recordsToReturn = [
      { record_source: "user", attributes: { type: "message", text: "q1" } },
      { record_source: "agent", attributes: { type: "message", text: "a1" } },
    ];
    const req = { messages: [userTurn], harness: "pi" } as never;
    const out = await reconstructHistoryIfNeeded(req, "sess-1", auth);
    assert.notEqual(out, null);
    assert.equal(fetchCalls, 1);
  });

  it('an empty flag (compose "${VAR:-}" passthrough) still means on', async () => {
    vi.stubEnv("AGENTA_SESSIONS_RECONSTRUCT", "");
    recordsToReturn = [
      { record_source: "user", attributes: { type: "message", text: "q1" } },
      { record_source: "agent", attributes: { type: "message", text: "a1" } },
    ];
    const req = { messages: [userTurn], harness: "pi" } as never;
    const out = await reconstructHistoryIfNeeded(req, "sess-1", auth);
    assert.notEqual(out, null);
    assert.equal(fetchCalls, 1);
  });

  it("no-op when the client already sent a full history", async () => {
    vi.stubEnv("AGENTA_SESSIONS_RECONSTRUCT", "true");
    const req = { messages: [userTurn, userTurn] } as never; // length > 1
    const out = await reconstructHistoryIfNeeded(req, "sess-1", auth);
    assert.equal(out, null);
    assert.equal(fetchCalls, 0);
  });

  it("no-op when there is no session id", async () => {
    vi.stubEnv("AGENTA_SESSIONS_RECONSTRUCT", "true");
    const req = { messages: [userTurn] } as never;
    const out = await reconstructHistoryIfNeeded(req, undefined, auth);
    assert.equal(out, null);
    assert.equal(fetchCalls, 0);
  });

  it("no-op when the record log is empty", async () => {
    vi.stubEnv("AGENTA_SESSIONS_RECONSTRUCT", "true");
    recordsToReturn = [];
    const req = { messages: [userTurn] } as never;
    const out = await reconstructHistoryIfNeeded(req, "sess-1", auth);
    assert.equal(out, null);
  });

  it("fails the turn when the records fetch fails (the client kept no history to fall back to)", async () => {
    vi.stubEnv("AGENTA_SESSIONS_RECONSTRUCT", "true");
    fetchShouldFail = true;
    const req = { messages: [userTurn] } as never;
    await assert.rejects(
      () => reconstructHistoryIfNeeded(req, "sess-1", auth),
      /unreadable/,
    );
  });

  it("fails the turn when the session is known to have dropped a record", async () => {
    vi.stubEnv("AGENTA_SESSIONS_RECONSTRUCT", "true");
    noteRecordsIncomplete("sess-dropped");
    const req = { messages: [userTurn] } as never;
    await assert.rejects(
      () => reconstructHistoryIfNeeded(req, "sess-dropped", auth),
      /incomplete conversation/,
    );
    assert.equal(fetchCalls, 0, "no query when the log is already known bad");
  });

  it("prepends reconstructed prior turns to the inbound message when enabled", async () => {
    vi.stubEnv("AGENTA_SESSIONS_RECONSTRUCT", "true");
    recordsToReturn = [
      { record_source: "user", attributes: { type: "message", text: "q1" } },
      { record_source: "agent", attributes: { type: "message", text: "a1" } },
    ];
    const req = { messages: [userTurn], harness: "pi" } as never;
    const out = await reconstructHistoryIfNeeded(req, "sess-1", auth);
    assert.ok(out);
    assert.deepEqual(out!.messages, [
      { role: "user", content: "q1" },
      { role: "assistant", content: "a1" },
      userTurn,
    ]);
    // Other request fields are preserved.
    assert.equal((out as { harness?: string }).harness, "pi");
  });

  it("no-op when the request carries no messages at all", async () => {
    vi.stubEnv("AGENTA_SESSIONS_RECONSTRUCT", "true");
    const req = { messages: [] } as never;
    const out = await reconstructHistoryIfNeeded(req, "sess-1", auth);
    assert.equal(out, null);
    assert.equal(fetchCalls, 0);
  });

  it("no-op when the single inbound message is not a fresh user turn", async () => {
    vi.stubEnv("AGENTA_SESSIONS_RECONSTRUCT", "true");
    const req = { messages: [{ role: "assistant", content: "a1" }] } as never;
    const out = await reconstructHistoryIfNeeded(req, "sess-1", auth);
    assert.equal(out, null);
    assert.equal(fetchCalls, 0);
  });

  it("drops the current turn's own records so the prompt is not replayed twice", async () => {
    vi.stubEnv("AGENTA_SESSIONS_RECONSTRUCT", "true");
    // The runner persists the inbound prompt BEFORE the engine starts, so by the time this
    // runs the log already holds turn-2's own user record.
    recordsToReturn = [
      { turn_id: "turn-1", record_source: "user", attributes: { type: "message", text: "q1" } },
      { turn_id: "turn-1", record_source: "agent", attributes: { type: "message", text: "a1" } },
      { turn_id: "turn-2", record_source: "user", attributes: { type: "message", text: "hi again" } },
    ];
    const req = { messages: [userTurn], turnId: "turn-2" } as never;
    const out = await reconstructHistoryIfNeeded(req, "sess-1", auth);
    assert.ok(out);
    assert.deepEqual(out!.messages, [
      { role: "user", content: "q1" },
      { role: "assistant", content: "a1" },
      userTurn,
    ]);
  });

  it("no-op when the only records belong to the current turn (first turn of a session)", async () => {
    vi.stubEnv("AGENTA_SESSIONS_RECONSTRUCT", "true");
    recordsToReturn = [
      { turn_id: "turn-1", record_source: "user", attributes: { type: "message", text: "hi again" } },
    ];
    const req = { messages: [userTurn], turnId: "turn-1" } as never;
    const out = await reconstructHistoryIfNeeded(req, "sess-1", auth);
    assert.equal(out, null);
  });
});
