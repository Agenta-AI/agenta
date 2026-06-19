/**
 * Unit tests for the cross-turn HITL continuation substrate.
 *
 * Under the cold model the harness rebuilds context from the replayed transcript, and ACP
 * prompt content blocks cannot carry tool calls/results. So a resolved interaction (an
 * approved tool that ran, a client-fulfilled tool) must survive into the replay as text.
 * `messageTranscript` encodes tool turns; `buildTurnText` keeps them in the replayed history.
 *
 * Run: pnpm exec tsx test/continuation.test.ts
 */
import assert from "node:assert/strict";

import { messageTranscript, buildTurnText } from "../src/engines/rivet.ts";
import type { AgentRunRequest, ContentBlock } from "../src/protocol.ts";

// --- messageTranscript -------------------------------------------------------
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

// --- buildTurnText keeps a resolved tool turn in the replay ------------------
{
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
}

console.log("continuation.test.ts: all assertions passed");
