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

// S3: on any successful resume rung (HOT continuation OR S1 session/load) the ACP prompt is
// last-message-only; buildTurnText only runs on the cold path. This imports `runTurn`'s own
// decision function, so the pin fails if the shipped rule drifts.
describe("S3 skip-flatten: sendLastMessageOnly = continuation || loaded", () => {
  it("cold turn (neither flag): the full transcript is sent, not last-message-only", () => {
    assert.equal(sendLastMessageOnly({}), false);
  });

  it("HOT continuation turn: last-message-only", () => {
    assert.equal(sendLastMessageOnly({ continuation: true }), true);
  });

  it("S1 session/load rehydration turn: last-message-only", () => {
    assert.equal(sendLastMessageOnly({ loaded: true }), true);
  });

  it("both flags set (should not happen, but never double-flattens): still last-message-only", () => {
    assert.equal(sendLastMessageOnly({ continuation: true, loaded: true }), true);
  });
});
