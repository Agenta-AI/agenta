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

// RUN-TOOLERR-1: two sibling transports disagreed on what a failed tool call discloses to the
// model. direct.ts is normative — it logs the upstream body server-side and returns only the
// status code. callback.ts (every gateway/Composio tool) interpolated the body into the thrown
// error, landing internal detail / vendor messages / connected-account PII in a context a
// prompt-injected attacker can exfiltrate via a later tool call.
//
// The correctable-error signal does NOT ride that path: the gateway returns a business-level
// tool failure as HTTP 200 with `status.code = STATUS_CODE_ERROR` and the upstream message in
// `status.message` (api/oss/src/apis/fastapi/tools/router.py `call_tool`). A non-2xx is an
// infrastructure/config fault the model cannot fix by rewriting an argument.
describe("callAgentaTool error disclosure (RUN-TOOLERR-1)", () => {
  it("does NOT leak a non-2xx upstream body to the model, and logs it server-side", async () => {
    const secret = "connected-account-email: victim@example.com";
    stubFetch(502, `upstream exploded: ${secret}`);

    const logged: string[] = [];
    const realError = console.error;
    console.error = (...args: unknown[]) => logged.push(args.join(" "));

    try {
      await assert.rejects(
        () =>
          callAgentaTool(
            "http://agenta.local/tools/call",
            "Bearer tok",
            "send-email",
            "call-1",
            {},
          ),
        (err: Error) => {
          // The model sees the status code only — never the upstream body.
          assert.equal(err.message, "tool call send-email failed: HTTP 502");
          assert.ok(!err.message.includes(secret));
          assert.ok(!err.message.includes("upstream exploded"));
          return true;
        },
      );
    } finally {
      console.error = realError;
    }

    // The detail is not lost — it is kept server-side for the operator.
    assert.ok(logged.some((line) => line.includes(secret)));
    assert.ok(logged.some((line) => line.includes("HTTP 502")));
  });

  it("surfaces a 200/STATUS_CODE_ERROR status.message so the model can still self-correct", async () => {
    // The by-design regression guard: a correctable validation failure must reach the model.
    stubFetch(
      200,
      JSON.stringify({
        call: {
          data: { content: '{"successful": false}' },
          status: {
            code: "STATUS_CODE_ERROR",
            message: "missing required field `email`",
          },
        },
      }),
    );

    const result = await callAgentaTool(
      "http://agenta.local/tools/call",
      "Bearer tok",
      "send-email",
      "call-1",
      {},
    );

    assert.ok(result.includes("missing required field `email`"));
  });

  it("leaves a 200 success envelope alone (no error prefix)", async () => {
    stubFetch(
      200,
      JSON.stringify({
        call: {
          data: { content: "sent" },
          status: { code: "STATUS_CODE_OK", message: null },
        },
      }),
    );
    const result = await callAgentaTool(
      "http://agenta.local/tools/call",
      "Bearer tok",
      "send-email",
      "call-1",
      {},
    );
    assert.equal(result, "sent");
  });
});
