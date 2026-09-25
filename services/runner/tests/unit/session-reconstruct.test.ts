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
      rec("agent", {
        type: "tool_call",
        id: "c1",
        name: "web_search",
        input: { q: "x" },
      }),
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
      rec("agent", {
        type: "tool_call",
        id: "gate1",
        name: "delete_file",
        input: { p: "/x" },
      }),
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
      rec("agent", {
        type: "interaction_request",
        id: "i1",
        kind: "user_approval",
      }),
      rec("agent", { type: "done", stopReason: "end_turn" }),
    ]);
    assert.deepEqual(out, [
      { role: "user", content: "hi" },
      { role: "assistant", content: "answer" },
    ]);
  });

  it("keeps a failed turn's question and drops what the agent did in it, by its turn id", () => {
    // Session 53da670e: the provider refused a tool result about its own model. Replaying the
    // tool result and the refusal text made every later turn fail too. The person's question
    // stays, so "continue" after a failure still has something to continue. The same rule as the
    // in-process rollback (`InProcessAcpSession.rollbackFailedTurn`).
    const out = reconstructMessages([
      rec("user", { type: "message", text: "hi" }, { turn_id: "t1" }),
      rec("agent", { type: "message", text: "hello" }, { turn_id: "t1" }),
      rec("user", { type: "message", text: "check the pricing" }, { turn_id: "t2" }),
      rec("agent", { type: "tool_call", id: "c1", name: "bash", input: { command: "curl" } }, { turn_id: "t2" }),
      rec("agent", { type: "tool_result", id: "c1", output: "Mercury is a diffusion LLM" }, { turn_id: "t2" }),
      rec("agent", { type: "error", message: "Upstream error from Inception: I'm sorry" }, { turn_id: "t2" }),
      rec("user", { type: "message", text: "hello?" }, { turn_id: "t3" }),
      rec("agent", { type: "error", message: "Upstream error from Inception: I'm sorry" }, { turn_id: "t3" }),
      rec("user", { type: "message", text: "thanks" }, { turn_id: "t4" }),
      rec("agent", { type: "message", text: "welcome" }, { turn_id: "t4" }),
    ]);
    assert.deepEqual(out, [
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
      { role: "user", content: "check the pricing" },
      { role: "user", content: "hello?" },
      { role: "user", content: "thanks" },
      { role: "assistant", content: "welcome" },
    ]);
    assert.doesNotMatch(JSON.stringify(out), /Mercury|Inception|error/);
  });

  it("drops what the agent did in a failed turn by its user-message span when records carry no turn id", () => {
    const out = reconstructMessages([
      rec("user", { type: "message", text: "q1" }),
      rec("agent", { type: "message", text: "a1" }),
      rec("user", { type: "message", text: "go" }),
      rec("agent", { type: "message", text: "partial" }),
      rec("agent", { type: "tool_call", id: "c2", name: "bash", input: {} }),
      rec("agent", { type: "tool_result", id: "c2", output: "secret-ish output" }),
      rec("agent", { type: "error", message: "boom" }),
      rec("user", { type: "message", text: "q3" }),
      rec("agent", { type: "tool_call", id: "c3", name: "bash", input: {} }),
      rec("agent", { type: "tool_result", id: "c3", output: "kept" }),
    ]);
    assert.deepEqual(out, [
      { role: "user", content: "q1" },
      { role: "assistant", content: "a1" },
      { role: "user", content: "go" },
      { role: "user", content: "q3" },
      {
        role: "assistant",
        content: [
          { type: "tool_call", toolCallId: "c3", toolName: "bash", input: {} },
          { type: "tool_result", toolCallId: "c3", toolName: "bash", output: "kept", isError: undefined },
        ],
      },
    ]);
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

  it("rebuilds user attachment references before exactly one text block", () => {
    const attachmentId = "11111111-1111-4111-8111-111111111111";
    const out = reconstructMessages([
      rec("user", {
        type: "message",
        text: "inspect this",
        attachments: [
          {
            attachmentId,
            filename: "report.pdf",
            mediaType: "application/pdf",
            size: 42,
          },
        ],
      }),
    ]);

    assert.deepEqual(out, [
      {
        role: "user",
        content: [
          {
            type: "attachment",
            attachmentId,
            filename: "report.pdf",
            mimeType: "application/pdf",
            size: 42,
          },
          { type: "text", text: "inspect this" },
        ],
      },
    ]);
  });
});

it("restores full execution text exactly once despite a display override", () => {
  for (const display_content of [undefined, null, "Visible", ""]) {
    const full = "Visible\nTemplate-supplied setup guidance: COBALT-47";
    const messages = reconstructMessages([
      rec("user", { type: "message", text: full, display_content }),
      rec("agent", { type: "message", text: "Ready" }),
      rec("user", { type: "message", text: "Follow up" }),
    ]);
    assert.deepEqual(messages, [
      { role: "user", content: full },
      { role: "assistant", content: "Ready" },
      { role: "user", content: "Follow up" },
    ]);
  }
});
