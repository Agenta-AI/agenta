/**
 * Unit tests for the note that frames a user message following an unanswered one.
 *
 * Run: pnpm exec vitest run tests/unit/superseded-turn.test.ts
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";

import type { ChatMessage } from "../../src/protocol.ts";
import { followsUnansweredUserTurn } from "../../src/engines/sandbox_agent/superseded-turn.ts";

const user = (content: ChatMessage["content"]): ChatMessage => ({
  role: "user",
  content,
});
const assistant = (content: string): ChatMessage => ({
  role: "assistant",
  content,
});

describe("followsUnansweredUserTurn", () => {
  it("is true when a stopped request got no reply before the new message", () => {
    assert.equal(
      followsUnansweredUserTurn([
        user("run sleep 20"),
        user("Reply with exactly: X"),
      ]),
      true,
    );
  });

  it("is false when the model replied between the two messages", () => {
    assert.equal(
      followsUnansweredUserTurn([
        user("run sleep 20"),
        assistant("Running it."),
        user("stop"),
      ]),
      false,
    );
  });

  it("is false for the first message of a session", () => {
    assert.equal(followsUnansweredUserTurn([user("hello")]), false);
    assert.equal(followsUnansweredUserTurn([]), false);
    assert.equal(followsUnansweredUserTurn(undefined), false);
  });

  it("is false when the tail is not a user message", () => {
    assert.equal(followsUnansweredUserTurn([user("a"), assistant("b")]), false);
  });

  it("ignores user-role messages that carry tool calls or tool results", () => {
    const toolResult = user([
      { type: "tool_result", toolCallId: "t1", output: "ok" } as never,
    ]);
    assert.equal(followsUnansweredUserTurn([toolResult, user("next")]), false);
    assert.equal(followsUnansweredUserTurn([user("first"), toolResult]), false);
  });

  it("accepts content-block user messages", () => {
    assert.equal(
      followsUnansweredUserTurn([
        user([{ type: "text", text: "run sleep 20" }]),
        user([{ type: "text", text: "never mind" }]),
      ]),
      true,
    );
  });
});
