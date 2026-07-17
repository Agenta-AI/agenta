/**
 * Unit test for the createSandboxAgentOtel delta/lifecycle state machine.
 *
 * Drives `handleUpdate` with a hand-built ACP `session/update` sequence (Claude-style
 * cumulative text snapshots, a tool call between two text runs, a reasoning run) and asserts
 * the streaming and one-shot event shapes. No harness, no network: spans are built offline
 * and never flushed.
 *
 * Run: pnpm test (or: pnpm exec vitest run tests/unit/stream-events.test.ts)
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";

import {
  createSandboxAgentOtel,
  TOOL_NOT_EXECUTED_PAUSED,
} from "../../src/tracing/otel.ts";
import type { AgentEvent } from "../../src/protocol.ts";

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
const usage = () => ({
  sessionUpdate: "usage_update",
  used: 100,
  cost: { amount: 0.01 },
});

// The same ACP sequence drives both modes: two text runs around a tool call, then reasoning.
function drive(run: ReturnType<typeof createSandboxAgentOtel>): void {
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

describe("createSandboxAgentOtel state machine", () => {
  it("scenario 1: streaming (emit set) yields pure deltas and balanced lifecycle", () => {
    const emitted: AgentEvent[] = [];
    const run = createSandboxAgentOtel({
      harness: "claude",
      model: "anthropic/x",
      emit: (e) => emitted.push(e),
    });
    drive(run);
    const finalText = run.finish();

    // No coalesced text events on the streaming path.
    assert.equal(
      ofType(emitted, "message").length,
      0,
      "no coalesced message when streaming",
    );
    assert.equal(
      ofType(emitted, "thought").length,
      0,
      "no coalesced thought when streaming",
    );

    // Exactly one terminal done.
    assert.equal(ofType(emitted, "done").length, 1, "exactly one done");

    // Two text blocks (split by the tool call), one reasoning block, balanced start/end.
    const mStart = ofType(emitted, "message_start");
    const mEnd = ofType(emitted, "message_end");
    assert.equal(mStart.length, 2, "two message_start");
    assert.equal(mEnd.length, 2, "two message_end");
    assert.deepEqual(
      mStart.map((e) => e.id),
      ["msg-0", "msg-1"],
      "stable monotonic text ids",
    );
    const rStart = ofType(emitted, "thought_start");
    const rEnd = ofType(emitted, "thought_end");
    assert.equal(rStart.length, 1, "one thought_start");
    assert.equal(rEnd.length, 1, "one thought_end");

    // Deltas are pure and reconstruct the full text, with no overlap/repeat.
    const text = ofType(emitted, "message_delta")
      .map((e) => e.delta)
      .join("");
    assert.equal(
      text,
      "Hello world It is sunny.",
      "concatenated deltas == full text",
    );
    assert.equal(text, finalText, "deltas match finish() output");
    const reasoning = ofType(emitted, "thought_delta")
      .map((e) => e.delta)
      .join("");
    assert.equal(reasoning, "thinking...", "concatenated thought deltas");

    // Ordering invariant: each block's start precedes its deltas precede its end; tool result
    // lands before the second text block opens.
    const seq = types(emitted);
    assert.ok(
      seq.indexOf("message_end") < seq.indexOf("tool_call"),
      "first text block closes before the tool call",
    );
    assert.ok(
      seq.indexOf("tool_result") < seq.lastIndexOf("message_start"),
      "tool result precedes the second text block",
    );
    for (const id of ["msg-0", "msg-1", "reason-2"]) {
      const idxs = emitted
        .map((e, i) => ((e as any).id === id ? { i, t: e.type } : null))
        .filter(Boolean) as { i: number; t: string }[];
      assert.ok(idxs[0].t.endsWith("_start"), `${id} starts with *_start`);
      assert.ok(
        idxs[idxs.length - 1].t.endsWith("_end"),
        `${id} ends with *_end`,
      );
    }
  });

  it("stamps stopReason on the terminal done so a paused turn is distinguishable on replay", () => {
    // A paused turn's `done` must carry stopReason=paused: the FE replay uses it to NOT treat the
    // paused turn as a boundary (which would strand a parked gate from its resume). Default finish()
    // (a completed turn) leaves it unset.
    const paused: AgentEvent[] = [];
    createSandboxAgentOtel({
      harness: "claude",
      model: "anthropic/x",
      emit: (e) => paused.push(e),
    }).finish({
      stopReason: "paused",
    });
    const pausedDone = ofType(paused, "done");
    assert.equal(pausedDone.length, 1, "one done");
    assert.equal(
      (pausedDone[0] as any).stopReason,
      "paused",
      "paused done carries stopReason",
    );

    const completed: AgentEvent[] = [];
    createSandboxAgentOtel({
      harness: "claude",
      model: "anthropic/x",
      emit: (e) => completed.push(e),
    }).finish();
    assert.equal(
      (ofType(completed, "done")[0] as any).stopReason,
      undefined,
      "a completed turn's done has no stopReason",
    );
  });

  it("scenario 2: one-shot (no emit) coalesces text/thought and keeps structured events", () => {
    const run = createSandboxAgentOtel({
      harness: "claude",
      model: "anthropic/x",
    });
    drive(run);
    const finalText = run.finish();
    const events = run.events();

    // Coalesced text/thought, no delta lifecycle events.
    const messages = ofType(events, "message");
    assert.equal(messages.length, 1, "one coalesced message");
    assert.equal(
      messages[0].text,
      "Hello world It is sunny.",
      "coalesced text == final",
    );
    assert.equal(messages[0].text, finalText);
    assert.equal(ofType(events, "thought").length, 1, "one coalesced thought");
    for (const t of [
      "message_start",
      "message_delta",
      "message_end",
      "thought_start",
      "thought_delta",
      "thought_end",
    ]) {
      assert.equal(
        events.filter((e) => e.type === t).length,
        0,
        `no ${t} on the one-shot path`,
      );
    }

    // The structured tool/usage events are still present, with exactly one done.
    const calls = ofType(events, "tool_call");
    assert.equal(calls.length, 1, "tool_call present");
    assert.deepEqual(
      calls[0].input,
      { city: "Paris" },
      "tool_call carries the args from the initial notification",
    );
    assert.equal(
      ofType(events, "tool_result").length,
      1,
      "tool_result present",
    );
    assert.equal(ofType(events, "usage").length, 1, "usage present");
    assert.equal(ofType(events, "done").length, 1, "exactly one done");
  });

  it("scenario 3: span-less mode still records ACP events and final usage", () => {
    const run = createSandboxAgentOtel({
      harness: "pi",
      model: "openai-codex/x",
      emitSpans: false,
    });
    drive(run);
    run.setUsage({ input: 4, output: 6, total: 10, cost: 0.02 });
    const finalText = run.finish();
    const events = run.events();

    assert.equal(finalText, "Hello world It is sunny.");
    assert.equal(
      ofType(events, "message").length,
      1,
      "message present without spans",
    );
    assert.equal(
      ofType(events, "thought").length,
      1,
      "thought present without spans",
    );
    assert.equal(
      ofType(events, "tool_call").length,
      1,
      "tool_call present without spans",
    );
    assert.equal(
      ofType(events, "tool_result").length,
      1,
      "tool_result present without spans",
    );
    const usageEvents = ofType(events, "usage");
    assert.equal(usageEvents.length, 1, "usage present without spans");
    assert.deepEqual(
      usageEvents[0],
      { type: "usage", input: 4, output: 6, total: 10, cost: 0.02 },
      "final usage replaces stream-only usage before done",
    );
    assert.equal(
      ofType(events, "done").length,
      1,
      "exactly one done without spans",
    );
    assert.ok(
      types(events).indexOf("usage") < types(events).indexOf("done"),
      "usage precedes done",
    );
  });

  it("scenario 4: surfaces the tool_call up front, then refreshes its input from a later tool_call_update", () => {
    // The real Pi wire: the initial `tool_call` announces the call with NO args, and the args
    // land on a subsequent `tool_call_update`. The tool_call MUST surface immediately (the FE
    // tool part + HITL approval attach to it), and then a second tool_call REFRESHES the input
    // once the real args arrive — so a non-gated tool shows its args instead of `{}`.
    const emitted: AgentEvent[] = [];
    const run = createSandboxAgentOtel({
      harness: "pi",
      model: "openai-codex/x",
      emit: (e) => emitted.push(e),
      emitSpans: false,
    });
    run.start({ prompt: "list connections" });
    run.handleUpdate({
      sessionUpdate: "tool_call",
      toolCallId: "c1",
      title: "list_connections",
    }); // no rawInput yet
    // The call surfaces immediately (emit-first invariant), before any args or result.
    assert.equal(
      ofType(emitted, "tool_call").length,
      1,
      "tool_call emitted up front, on the initial notification",
    );
    run.handleUpdate({
      sessionUpdate: "tool_call_update",
      toolCallId: "c1",
      rawInput: { limit: 50 },
    }); // args land here
    run.handleUpdate({
      sessionUpdate: "tool_call_update",
      toolCallId: "c1",
      status: "completed",
      content: [{ content: { type: "text", text: "ok" } }],
    });
    run.finish();

    const calls = ofType(emitted, "tool_call");
    assert.equal(calls.length, 2, "one initial surface + one input refresh");
    assert.deepEqual(
      calls[calls.length - 1].input,
      { limit: 50 },
      "the refresh carries the real args from the tool_call_update",
    );
    const seq = types(emitted);
    assert.ok(
      seq.indexOf("tool_call") !== -1 &&
        seq.indexOf("tool_call") < seq.indexOf("tool_result"),
      "tool_call precedes its result",
    );
  });

  it("scenario 5: an empty initial input is not refreshed when no real args ever arrive", () => {
    // An `{}` announcement with no later args stays a single surfaced call — no phantom refresh,
    // still a clean tool_call -> tool_result pair.
    const emitted: AgentEvent[] = [];
    const run = createSandboxAgentOtel({
      harness: "pi",
      model: "openai-codex/x",
      emit: (e) => emitted.push(e),
      emitSpans: false,
    });
    run.start({ prompt: "x" });
    run.handleUpdate({
      sessionUpdate: "tool_call",
      toolCallId: "c1",
      title: "noArgs",
      rawInput: {},
    }); // empty placeholder
    run.handleUpdate({
      sessionUpdate: "tool_call_update",
      toolCallId: "c1",
      status: "completed",
      content: [{ content: { type: "text", text: "done" } }],
    });
    run.finish();

    const calls = ofType(emitted, "tool_call");
    assert.equal(calls.length, 1, "single surfaced call, no refresh");
    assert.deepEqual(calls[0].input, {}, "keeps the placeholder input");
    assert.equal(
      ofType(emitted, "tool_result").length,
      1,
      "tool_result present",
    );
    const seq = types(emitted);
    assert.ok(
      seq.indexOf("tool_call") < seq.indexOf("tool_result"),
      "tool_call precedes its result",
    );
  });

  it("settleOpenToolCalls excludes paused calls and is idempotent per open sibling", () => {
    const emitted: AgentEvent[] = [];
    const run = createSandboxAgentOtel({
      harness: "claude",
      model: "anthropic/x",
      emit: (e) => emitted.push(e),
      emitSpans: false,
    });
    run.start({ prompt: "x" });
    run.handleUpdate(toolCall("call_1", "needsApproval", { a: 1 }));
    run.handleUpdate(toolCall("call_2", "sibling", { b: 2 }));

    run.settleOpenToolCalls((id) => id === "call_1", TOOL_NOT_EXECUTED_PAUSED);

    let results = ofType(emitted, "tool_result");
    assert.equal(
      results.some((event) => event.id === "call_1"),
      false,
      "excluded call remains pending",
    );
    assert.deepEqual(
      results
        .filter((event) => event.id === "call_2")
        .map((event) => ({ output: event.output, isError: event.isError })),
      [{ output: TOOL_NOT_EXECUTED_PAUSED, isError: true }],
    );

    run.settleOpenToolCalls(() => false, "second sweep");
    results = ofType(emitted, "tool_result");
    assert.equal(
      results.filter((event) => event.id === "call_2").length,
      1,
      "already-settled sibling is not recorded twice",
    );
    assert.equal(
      results.filter((event) => event.id === "call_1").length,
      1,
      "previously excluded call can settle on a later sweep",
    );
  });

  it("scenario 7: growing arg deltas keep refreshing until the FINAL args are recorded", () => {
    // The real Pi wire for streamed args: the initial `tool_call` announces with `{}`, then
    // tool_call_update frames carry a GROWING partial parse of the args (e.g. {use_cases:[""]}),
    // and the final update has the complete args. The last recorded tool_call input MUST be the
    // final args — a refresh-once gate that stops at the first partial delta records a lie
    // (the executor demonstrably ran with the full args).
    const emitted: AgentEvent[] = [];
    const run = createSandboxAgentOtel({
      harness: "pi",
      model: "openai-codex/x",
      emit: (e) => emitted.push(e),
      emitSpans: false,
    });
    run.start({ prompt: "x" });
    run.handleUpdate({
      sessionUpdate: "tool_call",
      toolCallId: "c1",
      title: "compare",
      rawInput: {},
    });
    run.handleUpdate({
      sessionUpdate: "tool_call_update",
      toolCallId: "c1",
      rawInput: { use_cases: [""] },
    }); // early partial delta
    run.handleUpdate({
      sessionUpdate: "tool_call_update",
      toolCallId: "c1",
      rawInput: { use_cases: ["a", "b"], limit: 5 },
    }); // final args
    run.handleUpdate({
      sessionUpdate: "tool_call_update",
      toolCallId: "c1",
      status: "completed",
      content: [{ content: { type: "text", text: "ok" } }],
    });
    run.finish();

    const calls = ofType(emitted, "tool_call");
    assert.deepEqual(
      calls[calls.length - 1].input,
      { use_cases: ["a", "b"], limit: 5 },
      "the LAST refresh carries the final args",
    );
    const seq = types(emitted);
    assert.ok(
      seq.lastIndexOf("tool_call") < seq.indexOf("tool_result"),
      "every refresh precedes the result",
    );
  });

  it("scenario 8: a call announced with PARTIAL args still refreshes when the full args arrive", () => {
    // The initial notification itself can carry an early partial parse (non-empty), so a
    // has-args-at-announce gate must not suppress the refresh with the real args.
    const emitted: AgentEvent[] = [];
    const run = createSandboxAgentOtel({
      harness: "pi",
      model: "openai-codex/x",
      emit: (e) => emitted.push(e),
      emitSpans: false,
    });
    run.start({ prompt: "x" });
    run.handleUpdate({
      sessionUpdate: "tool_call",
      toolCallId: "c1",
      title: "read",
      rawInput: { path: "/" },
    }); // partial
    run.handleUpdate({
      sessionUpdate: "tool_call_update",
      toolCallId: "c1",
      rawInput: { path: "/etc/hosts" },
    }); // real args
    run.handleUpdate({
      sessionUpdate: "tool_call_update",
      toolCallId: "c1",
      status: "completed",
      content: [{ content: { type: "text", text: "ok" } }],
    });
    run.finish();

    const calls = ofType(emitted, "tool_call");
    assert.equal(calls.length, 2, "one initial surface + one input refresh");
    assert.deepEqual(
      calls[calls.length - 1].input,
      { path: "/etc/hosts" },
      "the refresh carries the real args",
    );
  });

  it("scenario 6: a call announced WITH args refreshes only on genuinely new args", () => {
    // If the initial notification already has real args, that's the input — a later update that
    // merely repeats/omits args must NOT emit a duplicate tool_call.
    const emitted: AgentEvent[] = [];
    const run = createSandboxAgentOtel({
      harness: "pi",
      model: "openai-codex/x",
      emit: (e) => emitted.push(e),
      emitSpans: false,
    });
    run.start({ prompt: "x" });
    run.handleUpdate({
      sessionUpdate: "tool_call",
      toolCallId: "c1",
      title: "getWeather",
      rawInput: { city: "Paris" },
    });
    run.handleUpdate({
      sessionUpdate: "tool_call_update",
      toolCallId: "c1",
      status: "completed",
      content: [{ content: { type: "text", text: "sunny" } }],
    });
    run.finish();

    const calls = ofType(emitted, "tool_call");
    assert.equal(calls.length, 1, "no refresh — args were present up front");
    assert.deepEqual(
      calls[0].input,
      { city: "Paris" },
      "keeps the initial args",
    );
  });

  it("scenario 7: a denied gate stamps `denied` on the closing failed tool_result", () => {
    // The runner replied `reject`, so it flags the id via markToolCallDenied. The harness then
    // closes the call as a FAILED tool call; the tool_result must carry `denied: true` so the
    // egress projects a decline, not a breakage.
    const emitted: AgentEvent[] = [];
    const run = createSandboxAgentOtel({ harness: "claude", model: "anthropic/x", emit: (e) => emitted.push(e) });
    run.start({ prompt: "x" });
    run.handleUpdate({ sessionUpdate: "tool_call", toolCallId: "c1", title: "deleteFile", rawInput: {} });
    run.markToolCallDenied("c1");
    run.handleUpdate({ sessionUpdate: "tool_call_update", toolCallId: "c1", status: "failed", content: [{ content: { type: "text", text: "User refused permission" } }] });
    run.finish();

    const results = ofType(emitted, "tool_result");
    assert.equal(results.length, 1, "one tool_result");
    assert.equal(results[0].isError, true, "a denied close still rides isError");
    assert.equal(results[0].denied, true, "the denied marker is stamped");
  });

  it("scenario 8: a genuine tool failure (no markToolCallDenied) is NOT flagged denied", () => {
    const emitted: AgentEvent[] = [];
    const run = createSandboxAgentOtel({ harness: "claude", model: "anthropic/x", emit: (e) => emitted.push(e) });
    run.start({ prompt: "x" });
    run.handleUpdate({ sessionUpdate: "tool_call", toolCallId: "c1", title: "deleteFile", rawInput: {} });
    run.handleUpdate({ sessionUpdate: "tool_call_update", toolCallId: "c1", status: "failed", content: [{ content: { type: "text", text: "disk full" } }] });
    run.finish();

    const results = ofType(emitted, "tool_result");
    assert.equal(results.length, 1, "one tool_result");
    assert.equal(results[0].isError, true, "a real failure rides isError");
    assert.equal(results[0].denied, undefined, "no denied marker on a genuine failure");
  });
});
