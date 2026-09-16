/**
 * Unit tests for the cross-turn HITL continuation substrate.
 *
 * Under the cold model the harness rebuilds context from the replayed transcript, and ACP
 * prompt content blocks cannot carry tool calls/results. So a resolved interaction (an
 * approved tool that ran, a client-fulfilled tool) must survive into the replay as text.
 * `messageTranscript` encodes tool turns; `buildTurnText` keeps them in the replayed history.
 *
 * Run: pnpm test (or: pnpm exec vitest run tests/unit/continuation.test.ts)
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";

import {
  messageTranscript,
  buildTurnText,
  sendLastMessageOnly,
} from "../../src/engines/sandbox_agent.ts";
import {
  resolveRunSessionId,
  type AgentRunRequest,
  type ContentBlock,
} from "../../src/protocol.ts";

describe("messageTranscript", () => {
  it("encodes plain text, content blocks, and tool turns", () => {
    assert.equal(messageTranscript("hello"), "hello");
    assert.equal(messageTranscript([{ type: "text", text: "a" }, { type: "text", text: "b" }]), "a\nb");
    assert.equal(
      messageTranscript([{ type: "tool_call", toolName: "getWeather", input: { city: "Paris" } }]),
      '[called getWeather({"city":"Paris"})]',
    );
    assert.equal(
      messageTranscript([{ type: "tool_result", toolName: "getWeather", output: { temp: 24 } }]),
      '[getWeather returned: {"temp":24}]',
    );
    assert.equal(
      messageTranscript([{ type: "tool_result", toolName: "send", output: "boom", isError: true }]),
      "[send error: boom]",
    );
  });
});

describe("resolveRunSessionId", () => {
  it("prefers the platform session id, falling back to the ephemeral one", () => {
    assert.equal(
      resolveRunSessionId({ sessionId: "sess_platform" }, "runner-ephemeral"),
      "sess_platform",
    );
    assert.equal(resolveRunSessionId({}, "runner-ephemeral"), "runner-ephemeral");
  });
});

describe("buildTurnText", () => {
  it("keeps a resolved tool turn in the replay", () => {
    const req: AgentRunRequest = {
      messages: [
        { role: "user", content: "weather in Paris?" },
        {
          role: "assistant",
          content: [{ type: "tool_call", toolName: "getWeather", input: { city: "Paris" } } as ContentBlock],
        },
        {
          role: "tool",
          content: [{ type: "tool_result", toolName: "getWeather", output: { temp: 24 } } as ContentBlock],
        },
        { role: "user", content: "and tomorrow?" },
      ],
    };
    const text = buildTurnText(req);
    assert.ok(text.includes("called getWeather"), "tool call survives replay");
    assert.ok(text.includes("getWeather returned"), "tool result survives replay");
    assert.ok(text.includes("and tomorrow?"), "latest user prompt is the live turn");
    assert.ok(text.startsWith("Conversation so far:"), "transcript header present");
  });
});

// S3: HOT continuation is intrinsically verified because the live harness never went away. A
// cold `session/load` must additionally prove that native history was replayed; accepting the id
// alone is not enough to discard the reconstructed transcript.
describe("S3 skip-flatten: only verified native history uses last-message-only", () => {
  it("cold turn (neither flag): the full transcript is sent, not last-message-only", () => {
    assert.equal(sendLastMessageOnly({}), false);
  });

  it("HOT continuation turn: last-message-only", () => {
    assert.equal(sendLastMessageOnly({ continuation: true }), true);
  });

  it("S1 session/load that only accepted the id: full reconstructed transcript", () => {
    assert.equal(sendLastMessageOnly({ loaded: true }), false);
  });

  it("S1 session/load with observed native history: last-message-only", () => {
    assert.equal(
      sendLastMessageOnly({ loaded: true, nativeHistoryVerified: true }),
      true,
    );
  });

  it("both flags set (should not happen, but never double-flattens): still last-message-only", () => {
    assert.equal(
      sendLastMessageOnly({
        continuation: true,
        loaded: true,
        nativeHistoryVerified: false,
      }),
      true,
    );
  });
});
