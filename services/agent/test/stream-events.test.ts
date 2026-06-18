/**
 * Unit test for the createRivetOtel delta/lifecycle state machine.
 *
 * Drives `handleUpdate` with a hand-built ACP `session/update` sequence (Claude-style
 * cumulative text snapshots, a tool call between two text runs, a reasoning run) and asserts
 * the streaming and one-shot event shapes. No harness, no network: spans are built offline
 * and never flushed.
 *
 * Run: pnpm exec tsx test/stream-events.test.ts
 */
import assert from "node:assert/strict";

import { createRivetOtel } from "../src/tracing/otel.ts";
import type { AgentEvent } from "../src/protocol.ts";

const textChunk = (text: string) => ({
  sessionUpdate: "agent_message_chunk",
  content: { type: "text", text },
});
const thoughtChunk = (text: string) => ({
  sessionUpdate: "agent_thought_chunk",
  content: { type: "text", text },
});
const toolCall = (id: string, title: string, rawInput: unknown) => ({
  sessionUpdate: "tool_call",
  toolCallId: id,
  title,
  rawInput,
});
const toolDone = (id: string, text: string) => ({
  sessionUpdate: "tool_call_update",
  toolCallId: id,
  status: "completed",
  content: [{ content: { type: "text", text } }],
});
const usage = () => ({ sessionUpdate: "usage_update", used: 100, cost: { amount: 0.01 } });

// The same ACP sequence drives both modes: two text runs around a tool call, then reasoning.
function drive(run: ReturnType<typeof createRivetOtel>): void {
  run.start({ prompt: "weather in Paris?" });
  run.handleUpdate(textChunk("Hello ")); // pure delta
  run.handleUpdate(textChunk("Hello world")); // cumulative snapshot (Claude-style)
  run.handleUpdate(toolCall("call_1", "getWeather", { city: "Paris" }));
  run.handleUpdate(toolDone("call_1", "sunny"));
  run.handleUpdate(textChunk("Hello world It is sunny.")); // resumes after the tool
  run.handleUpdate(thoughtChunk("thinking..."));
  run.handleUpdate(usage());
}

const types = (events: AgentEvent[]) => events.map((e) => e.type);
const ofType = <T extends AgentEvent["type"]>(events: AgentEvent[], t: T) =>
  events.filter((e) => e.type === t) as Extract<AgentEvent, { type: T }>[];

// --- Scenario 1: streaming (emit set) ---------------------------------------
{
  const emitted: AgentEvent[] = [];
  const run = createRivetOtel({ harness: "claude", model: "anthropic/x", emit: (e) => emitted.push(e) });
  drive(run);
  const finalText = run.finish();

  // No coalesced text events on the streaming path.
  assert.equal(ofType(emitted, "message").length, 0, "no coalesced message when streaming");
  assert.equal(ofType(emitted, "thought").length, 0, "no coalesced thought when streaming");

  // Exactly one terminal done.
  assert.equal(ofType(emitted, "done").length, 1, "exactly one done");

  // Two text blocks (split by the tool call), one reasoning block, balanced start/end.
  const mStart = ofType(emitted, "message_start");
  const mEnd = ofType(emitted, "message_end");
  assert.equal(mStart.length, 2, "two message_start");
  assert.equal(mEnd.length, 2, "two message_end");
  assert.deepEqual(mStart.map((e) => e.id), ["msg-0", "msg-1"], "stable monotonic text ids");
  const rStart = ofType(emitted, "reasoning_start");
  const rEnd = ofType(emitted, "reasoning_end");
  assert.equal(rStart.length, 1, "one reasoning_start");
  assert.equal(rEnd.length, 1, "one reasoning_end");

  // Deltas are pure and reconstruct the full text, with no overlap/repeat.
  const text = ofType(emitted, "message_delta").map((e) => e.delta).join("");
  assert.equal(text, "Hello world It is sunny.", "concatenated deltas == full text");
  assert.equal(text, finalText, "deltas match finish() output");
  const reasoning = ofType(emitted, "reasoning_delta").map((e) => e.delta).join("");
  assert.equal(reasoning, "thinking...", "concatenated reasoning deltas");

  // Ordering invariant: each block's start precedes its deltas precede its end; tool result
  // lands before the second text block opens.
  const seq = types(emitted);
  assert.ok(seq.indexOf("message_end") < seq.indexOf("tool_call"), "first text block closes before the tool call");
  assert.ok(seq.indexOf("tool_result") < seq.lastIndexOf("message_start"), "tool result precedes the second text block");
  for (const id of ["msg-0", "msg-1", "reason-2"]) {
    const idxs = emitted
      .map((e, i) => ((e as any).id === id ? { i, t: e.type } : null))
      .filter(Boolean) as { i: number; t: string }[];
    assert.ok(idxs[0].t.endsWith("_start"), `${id} starts with *_start`);
    assert.ok(idxs[idxs.length - 1].t.endsWith("_end"), `${id} ends with *_end`);
  }
}

// --- Scenario 2: one-shot (no emit) -----------------------------------------
{
  const run = createRivetOtel({ harness: "claude", model: "anthropic/x" });
  drive(run);
  const finalText = run.finish();
  const events = run.events();

  // Coalesced text/thought, no delta lifecycle events.
  const messages = ofType(events, "message");
  assert.equal(messages.length, 1, "one coalesced message");
  assert.equal(messages[0].text, "Hello world It is sunny.", "coalesced text == final");
  assert.equal(messages[0].text, finalText);
  assert.equal(ofType(events, "thought").length, 1, "one coalesced thought");
  for (const t of ["message_start", "message_delta", "message_end", "reasoning_start", "reasoning_delta", "reasoning_end"]) {
    assert.equal(events.filter((e) => e.type === t).length, 0, `no ${t} on the one-shot path`);
  }

  // The structured tool/usage events are still present, with exactly one done.
  assert.equal(ofType(events, "tool_call").length, 1, "tool_call present");
  assert.equal(ofType(events, "tool_result").length, 1, "tool_result present");
  assert.equal(ofType(events, "usage").length, 1, "usage present");
  assert.equal(ofType(events, "done").length, 1, "exactly one done");
}

console.log("stream-events.test.ts: all assertions passed");
