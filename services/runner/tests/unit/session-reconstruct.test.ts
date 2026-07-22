/**
 * Unit tests for server-side history reconstruction (sessions/reconstruct.ts).
 *
 * Verifies the record-log fold produces the same ChatMessage/ContentBlock shape the vercel
 * adapter emits, so buildTurnText / priorMessages / the responder binding consume it unchanged.
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";

import type { ContentBlock } from "../../src/protocol.ts";
import { reconstructMessages } from "../../src/sessions/reconstruct.ts";
import type { SessionRecordRow } from "../../src/sessions/reconstruct.ts";

function rec(
  source: "user" | "agent",
  attributes: unknown,
  extra: Partial<SessionRecordRow> = {},
): SessionRecordRow {
  return { record_source: source, attributes, ...extra };
}

describe("reconstructMessages", () => {
  it("folds a simple user→assistant text exchange", () => {
    const out = reconstructMessages([
      rec("user", { type: "message", text: "hi" }),
      rec("agent", { type: "message", text: "hello there" }),
    ]);
    assert.deepEqual(out, [
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello there" },
    ]);
  });

  it("keeps turns in order across multiple exchanges", () => {
    const out = reconstructMessages([
      rec("user", { type: "message", text: "q1" }),
      rec("agent", { type: "message", text: "a1" }),
      rec("user", { type: "message", text: "q2" }),
      rec("agent", { type: "message", text: "a2" }),
    ]);
    assert.deepEqual(
      out.map((m) => [m.role, m.content]),
      [
        ["user", "q1"],
        ["assistant", "a1"],
        ["user", "q2"],
        ["assistant", "a2"],
      ],
    );
  });

  it("pairs a tool_call with its tool_result and carries the tool name forward", () => {
    const out = reconstructMessages([
      rec("user", { type: "message", text: "search" }),
      rec("agent", { type: "message", text: "let me look" }),
      rec("agent", { type: "tool_call", id: "c1", name: "web_search", input: { q: "x" } }),
      rec("agent", { type: "tool_result", id: "c1", output: "found" }),
      rec("agent", { type: "message", text: "done" }),
    ]);
    assert.equal(out.length, 2);
    const assistant = out[1];
    assert.equal(assistant.role, "assistant");
    assert.ok(Array.isArray(assistant.content));
    const blocks = assistant.content as ContentBlock[];
    assert.deepEqual(
      blocks.map((b) => b.type),
      ["text", "tool_call", "tool_result", "text"],
    );
    // The call block carries id + name + input for the responder's coldReplay binding.
    assert.equal(blocks[1].toolCallId, "c1");
    assert.equal(blocks[1].toolName, "web_search");
    assert.deepEqual(blocks[1].input, { q: "x" });
    // The result block inherits the tool name from its matching call.
    assert.equal(blocks[2].toolCallId, "c1");
    assert.equal(blocks[2].toolName, "web_search");
    assert.equal(blocks[2].output, "found");
  });

  it("keeps a still-parked tool_call (no result yet) so a later HITL answer can bind", () => {
    const out = reconstructMessages([
      rec("user", { type: "message", text: "delete it" }),
      rec("agent", { type: "tool_call", id: "gate1", name: "delete_file", input: { p: "/x" } }),
      // gate paused — no tool_result recorded for gate1
    ]);
    const blocks = out[1].content as ContentBlock[];
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].type, "tool_call");
    assert.equal(blocks[0].toolCallId, "gate1");
  });

  it("drops reasoning / usage / done / interaction lifecycle events", () => {
    const out = reconstructMessages([
      rec("user", { type: "message", text: "hi" }),
      rec("agent", { type: "thought", text: "thinking..." }),
      rec("agent", { type: "message", text: "answer" }),
      rec("agent", { type: "usage", input: 10, output: 5 }),
      rec("agent", { type: "interaction_request", id: "i1", kind: "user_approval" }),
      rec("agent", { type: "done", stopReason: "end_turn" }),
    ]);
    assert.deepEqual(out, [
      { role: "user", content: "hi" },
      { role: "assistant", content: "answer" },
    ]);
  });

  it("renders an error event as assistant text", () => {
    const out = reconstructMessages([
      rec("user", { type: "message", text: "go" }),
      rec("agent", { type: "error", message: "boom" }),
    ]);
    assert.deepEqual(out[1], { role: "assistant", content: "[error: boom]" });
  });

  it("ignores malformed / typeless attribute rows", () => {
    const out = reconstructMessages([
      rec("user", { type: "message", text: "hi" }),
      rec("agent", null),
      rec("agent", { noType: true }),
      rec("agent", { type: "message", text: "ok" }),
    ]);
    assert.deepEqual(out, [
      { role: "user", content: "hi" },
      { role: "assistant", content: "ok" },
    ]);
  });

  it("returns an empty history for no records", () => {
    assert.deepEqual(reconstructMessages([]), []);
  });
});
