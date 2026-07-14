/**
 * Unit tests for interaction ingest (sessions/interactions.ts).
 */
import { describe, it, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";

const postedBodies: Array<{url: string; body: unknown; headers: Record<string, string>}> = [];
let fetchFailCount = 0;

vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
  const body = init?.body ? JSON.parse(init.body as string) : undefined;
  const headers = Object.fromEntries(
    Object.entries(init?.headers ?? {}) as [string, string][],
  );
  if (fetchFailCount > 0) {
    fetchFailCount--;
    return new Response("error", { status: 500 });
  }
  postedBodies.push({ url: url as string, body, headers });
  return new Response(JSON.stringify({ ok: true }), { status: 200 });
});

const { createInteraction } = await import("../../src/sessions/interactions.ts");

beforeEach(() => {
  postedBodies.length = 0;
  fetchFailCount = 0;
});

describe("createInteraction", () => {
  it("POSTs to /sessions/interactions with correct body shape", async () => {
    await createInteraction(
      "sess-1",
      "turn-1",
      "tok-abc",
      "user_approval",
      { request: { tool: "bash", args: { cmd: "ls" } } },
      () => "Secret t",
    );
    assert.equal(postedBodies.length, 1);
    const { url, body, headers } = postedBodies[0];
    assert.ok(url.endsWith("/sessions/interactions/"));
    const b = body as any;
    assert.equal(b.session_id, "sess-1");
    assert.equal(b.turn_id, "turn-1");
    assert.equal(b.token, "tok-abc");
    assert.equal(b.kind, "user_approval");
    assert.deepEqual(b.data, {
      request: { tool: "bash", args: { cmd: "ls" } },
    });
    assert.deepEqual(b.flags, { delivered_in_band: true });
    assert.equal(headers["authorization"], "Secret t");
  });

  it("retries on failure then gives up without throwing", async () => {
    fetchFailCount = 3; // all 3 attempts fail
    await assert.doesNotReject(() =>
      createInteraction("sess-2", "turn-2", "tok-def", "user_approval", {}, () => "Secret t"),
    );
    assert.equal(postedBodies.length, 0);
  });

  it("succeeds after partial failures", async () => {
    fetchFailCount = 2; // first 2 fail, third succeeds
    await createInteraction("sess-3", "turn-3", "tok-ghi", "user_approval", {}, () => "Secret t");
    assert.equal(postedBodies.length, 1);
  });

  it("does not throw when auth returns empty string", async () => {
    await assert.doesNotReject(() =>
      createInteraction("sess-4", "turn-4", "tok-jkl", "user_input", {}, () => ""),
    );
  });
});
