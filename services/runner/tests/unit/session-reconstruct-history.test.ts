/**
 * Unit tests for the reconstruction seam (reconstruct-history.ts).
 *
 * The safety contract: a strict no-op until BOTH the flag is on AND the client sent a minimal
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

const auth = () => "Secret t";
const userTurn = { role: "user", content: "hi again" };

beforeEach(() => {
  fetchCalls = 0;
  recordsToReturn = [];
  fetchShouldFail = false;
  vi.unstubAllEnvs();
});

describe("reconstructHistoryIfNeeded", () => {
  it("no-op when the flag is off (never even queries)", async () => {
    const req = { messages: [userTurn] } as never;
    const out = await reconstructHistoryIfNeeded(req, "sess-1", auth);
    assert.equal(out, null);
    assert.equal(fetchCalls, 0);
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

  it("no-op (falls back) when the records fetch fails", async () => {
    vi.stubEnv("AGENTA_SESSIONS_RECONSTRUCT", "true");
    fetchShouldFail = true;
    const req = { messages: [userTurn] } as never;
    const out = await reconstructHistoryIfNeeded(req, "sess-1", auth);
    assert.equal(out, null);
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
});
