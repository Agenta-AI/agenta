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
  readBoundedResponseText,
  MAX_BODY_BYTES,
  MAX_RAW_RESPONSE_BYTES,
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

  it("truncates at a UTF-8 character boundary instead of splitting a multibyte sequence", () => {
    // "café" = c(1) a(1) f(1) é(2 bytes: 0xC3 0xA9). A cap of 4 lands mid-"é" (byte-cap would
    // slice after the 0xC3 lead byte, decode the dangling continuation-less byte as U+FFFD,
    // and re-expand to 3 bytes — pushing the result back OVER the 4-byte cap).
    const capped = capToolResultText("café", 4);
    const [prefix] = capped.split(" [...");
    assert.ok(!prefix.includes("�"), "must not contain a replacement character");
    assert.ok(
      Buffer.byteLength(prefix, "utf-8") <= 4,
      "the character-boundary-safe prefix must fit within the byte cap",
    );
    assert.equal(prefix, "caf"); // the incomplete "é" is walked back past entirely
    assert.equal(capped, "caf [... 2 bytes omitted]"); // "café" is 5 bytes; 3 kept, 2 omitted
  });

  it("omitted-byte count is exact and never negative for multibyte content straddling the cap", () => {
    // A run of 4-byte emoji (matches the max UTF-8 sequence length) straddling several cap
    // offsets — every offset must produce a non-negative, exact omitted count with no U+FFFD.
    const text = "😀".repeat(50); // 4 bytes each, 200 bytes total
    for (const cap of [1, 2, 3, 4, 5, 7, 9, 100, 197, 198, 199]) {
      const capped = capToolResultText(text, cap);
      const match = /\[\.\.\. (-?\d+) bytes omitted\]$/.exec(capped);
      assert.ok(match, `expected an omitted-bytes marker for cap=${cap}`);
      const omitted = Number(match![1]);
      assert.ok(omitted >= 0, `omitted count must not be negative (cap=${cap}, got ${omitted})`);
      const prefix = capped.slice(0, capped.indexOf(" [..."));
      assert.ok(
        !prefix.includes("�"),
        `prefix must not contain a replacement character (cap=${cap})`,
      );
      assert.ok(
        Buffer.byteLength(prefix, "utf-8") <= cap,
        `prefix must fit within the byte cap (cap=${cap})`,
      );
    }
  });
});

describe("readBoundedResponseText (RUN-TOOLCAP-2: cap before materializing the whole body)", () => {
  /** A ReadableStream that yields `chunks` one at a time, recording whether it was cancelled. */
  function streamOf(chunks: string[]): { stream: ReadableStream<Uint8Array>; cancelled: () => boolean } {
    let wasCancelled = false;
    let i = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (i < chunks.length) {
          controller.enqueue(new TextEncoder().encode(chunks[i++]));
        } else {
          controller.close();
        }
      },
      cancel() {
        wasCancelled = true;
      },
    });
    return { stream, cancelled: () => wasCancelled };
  }

  it("cancels the reader the moment a streamed response crosses the cap, without draining the rest", async () => {
    // Several chunks, each under the cap alone, that cross it partway through the run.
    const chunkSize = 10;
    const capBytes = 25; // crossed partway through the 3rd chunk
    const chunks = Array.from({ length: 20 }, () => "x".repeat(chunkSize));
    const { stream, cancelled } = streamOf(chunks);
    const response = new Response(stream);

    const { text, truncated } = await readBoundedResponseText(response, capBytes);

    assert.equal(truncated, true);
    assert.ok(Buffer.byteLength(text, "utf-8") <= capBytes);
    assert.equal(cancelled(), true);
    // Must not have pulled all 20 chunks worth of data (200 bytes) — proof it stopped early.
    assert.ok(Buffer.byteLength(text, "utf-8") < chunkSize * chunks.length);
  });

  it("does not truncate or cancel when the body is within the cap", async () => {
    const { stream, cancelled } = streamOf(["hello ", "world"]);
    const response = new Response(stream);

    const { text, truncated } = await readBoundedResponseText(response, MAX_RAW_RESPONSE_BYTES);

    assert.equal(text, "hello world");
    assert.equal(truncated, false);
    assert.equal(cancelled(), false);
  });

  it("truncates a streamed multibyte sequence at a character boundary, not mid-codepoint", async () => {
    // Force the cap to land exactly inside a 2-byte UTF-8 sequence ("é" = 0xC3 0xA9).
    const { stream } = streamOf(["caf", "é more text after"]);
    const response = new Response(stream);

    const { text, truncated } = await readBoundedResponseText(response, 4);

    assert.equal(truncated, true);
    assert.ok(!text.includes("�"));
    assert.equal(text, "caf");
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
