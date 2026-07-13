/**
 * Unit tests for the shared /tools/call callback transport (src/tools/callback.ts).
 *
 * Covers RUN-TOOLCAP-1: the tool result handed back to the model must be bounded the same
 * way tool-mcp-http.ts bounds an inbound request body (MAX_BODY_BYTES), and the model must be
 * able to tell a result was truncated (the same "[... N omitted]" shape transcript.ts already
 * uses for the replay-transcript cap).
 *
 * Run: pnpm exec vitest run tests/unit/callback.test.ts
 */
import { afterEach, describe, it } from "vitest";
import assert from "node:assert/strict";

import {
  callAgentaTool,
  capToolResultText,
  MAX_BODY_BYTES,
} from "../../src/tools/callback.ts";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function stubFetch(status: number, body: string): void {
  globalThis.fetch = (async () =>
    new Response(body, { status })) as typeof fetch;
}

describe("capToolResultText", () => {
  it("returns short text unchanged", () => {
    assert.equal(capToolResultText("hello"), "hello");
  });

  it("truncates at the byte cap and signals the cut, like transcript.ts", () => {
    const text = "a".repeat(MAX_BODY_BYTES + 500);
    const capped = capToolResultText(text);
    assert.ok(capped.length < text.length);
    assert.ok(capped.includes("bytes omitted"));
    assert.ok(capped.startsWith("a".repeat(100)));
  });

  it("respects a custom byte cap", () => {
    const capped = capToolResultText("abcdefghij", 4);
    assert.equal(capped, "abcd [... 6 bytes omitted]");
  });
});

describe("callAgentaTool result capping (RUN-TOOLCAP-1)", () => {
  it("caps an oversized string `content` before returning it to the model", async () => {
    const huge = "x".repeat(MAX_BODY_BYTES + 1000);
    stubFetch(
      200,
      JSON.stringify({ call: { data: { content: huge }, status: "done" } }),
    );
    const result = await callAgentaTool(
      "http://agenta.local/tools/call",
      "Bearer tok",
      "ref",
      "call-1",
      {},
    );
    assert.ok(Buffer.byteLength(result, "utf-8") <= MAX_BODY_BYTES + 200);
    assert.ok(result.includes("bytes omitted"));
  });

  it("caps an oversized non-string `content` (JSON.stringify'd) before returning it", async () => {
    const huge = { data: "y".repeat(MAX_BODY_BYTES + 1000) };
    stubFetch(
      200,
      JSON.stringify({ call: { data: { content: huge }, status: "done" } }),
    );
    const result = await callAgentaTool(
      "http://agenta.local/tools/call",
      "Bearer tok",
      "ref",
      "call-1",
      {},
    );
    assert.ok(result.includes("bytes omitted"));
  });

  it("caps a raw oversized body when the response is not the expected envelope shape", async () => {
    stubFetch(200, "z".repeat(MAX_BODY_BYTES + 1000));
    const result = await callAgentaTool(
      "http://agenta.local/tools/call",
      "Bearer tok",
      "ref",
      "call-1",
      {},
    );
    assert.ok(result.includes("bytes omitted"));
  });

  it("leaves a small result untouched", async () => {
    stubFetch(
      200,
      JSON.stringify({ call: { data: { content: "ok" }, status: "done" } }),
    );
    const result = await callAgentaTool(
      "http://agenta.local/tools/call",
      "Bearer tok",
      "ref",
      "call-1",
      {},
    );
    assert.equal(result, "ok");
  });
});
