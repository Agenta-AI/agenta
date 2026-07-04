/**
 * Unit tests for the shared client-tool seam (engines/sandbox_agent/client-tools.ts):
 * the ACP tool-call correlation index, the single client_tool interaction payload, and
 * buildClientToolRelay (emits + latches + marks the paused call on pendingApproval, returns
 * the responder's verdict as a relay outcome, and delegates onPause to the pause controller).
 *
 * Run: pnpm test (or: pnpm exec vitest run tests/unit/client-tools.test.ts)
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";

import type { AgentEvent } from "../../src/protocol.ts";
import type { ClientToolVerdict, Responder } from "../../src/responder.ts";
import type { ClientToolRelayRequest } from "../../src/tools/relay.ts";
import { PendingApprovalLatch } from "../../src/permission-plan.ts";
import {
  buildClientToolRelay,
  createToolCallCorrelationIndex,
  emitClientToolInteraction,
} from "../../src/engines/sandbox_agent/client-tools.ts";

function responderReturning(verdict: ClientToolVerdict): Responder {
  return {
    async onPermission() {
      return { kind: "deny" } as const;
    },
    async onClientTool() {
      return verdict;
    },
  };
}

/** A seam harness: fake pause controller + latch + captured events/interactions. */
function seam(verdict: ClientToolVerdict, opts: { index?: boolean } = {}) {
  const events: AgentEvent[] = [];
  const pausedToolCalls: string[] = [];
  const recorded: Array<{ token: string; toolName?: string; kind: string }> = [];
  let pauses = 0;
  const index = opts.index ? createToolCallCorrelationIndex() : undefined;
  const relay = buildClientToolRelay({
    responder: responderReturning(verdict),
    run: { emitEvent: (e) => events.push(e) },
    latch: new PendingApprovalLatch(),
    pause: {
      markPausedToolCall: (id) => pausedToolCalls.push(id),
      pause: () => {
        pauses += 1;
      },
    },
    recordPendingInteraction: (token, toolName, _args, kind) => {
      recorded.push({ token, toolName, kind });
    },
    toolCallIndex: index,
  });
  return { relay, events, pausedToolCalls, recorded, index, pauses: () => pauses };
}

const req: ClientToolRelayRequest = {
  id: "i-1",
  toolCallId: "tc-1",
  toolName: "request_connection",
  input: { integration: "slack" },
  spec: { name: "request_connection", kind: "client", render: { kind: "connect" } },
};

describe("createToolCallCorrelationIndex", () => {
  it("maps a live ACP tool_call (name + args) to its real toolCallId", () => {
    const index = createToolCallCorrelationIndex();
    index.record({
      sessionUpdate: "tool_call",
      toolCallId: "acp-real-1",
      title: "request_connection",
      rawInput: { integration: "slack" },
    });
    assert.equal(
      index.lookup("request_connection", { integration: "slack" }),
      "acp-real-1",
      "name+args resolves the real id",
    );
    // Bare-name fallback when the args differ but the name matched a recorded call.
    assert.equal(
      index.lookup("request_connection", { integration: "github" }),
      "acp-real-1",
      "name fallback when args differ",
    );
  });

  it("ignores non-tool_call updates and is first-write-wins", () => {
    const index = createToolCallCorrelationIndex();
    index.record({ sessionUpdate: "agent_message_chunk", text: "hi" });
    assert.equal(index.lookup("x", {}), undefined, "no record -> no id");
    index.record({ sessionUpdate: "tool_call", toolCallId: "id-1", title: "t" });
    index.record({ sessionUpdate: "tool_call", toolCallId: "id-2", title: "t" });
    assert.equal(index.lookup("t", {}), "id-1", "first write wins");
  });
});

describe("emitClientToolInteraction", () => {
  function collect() {
    const events: AgentEvent[] = [];
    return { run: { emitEvent: (e: AgentEvent) => events.push(e) }, events };
  }

  it("emits a client_tool interaction with the top-level + toolCall payload the egress reads", () => {
    const { run, events } = collect();
    emitClientToolInteraction(run, {
      id: "i-1",
      toolCallId: "minted-1",
      toolName: "request_connection",
      input: { integration: "slack" },
      render: { kind: "connect" },
    });
    assert.equal(events.length, 1);
    const ev = events[0] as any;
    assert.equal(ev.type, "interaction_request");
    assert.equal(ev.kind, "client_tool");
    assert.equal(ev.id, "i-1");
    assert.equal(ev.payload.toolCallId, "minted-1");
    assert.equal(ev.payload.toolName, "request_connection");
    assert.deepEqual(ev.payload.input, { integration: "slack" });
    assert.deepEqual(ev.payload.render, { kind: "connect" });
    // The synthesized toolCall sub-object (the egress reads either shape).
    assert.equal(ev.payload.toolCall.id, "minted-1");
    assert.equal(ev.payload.toolCall.name, "request_connection");
    assert.deepEqual(ev.payload.toolCall.rawInput, { integration: "slack" });
    assert.equal(ev.payload.toolCall.kind, "client");
  });

  it("substitutes the correlated ACP id when the index has one", () => {
    const { run, events } = collect();
    const index = createToolCallCorrelationIndex();
    index.record({
      sessionUpdate: "tool_call",
      toolCallId: "acp-real",
      title: "request_connection",
      rawInput: { integration: "slack" },
    });
    emitClientToolInteraction(
      run,
      {
        id: "i-1",
        toolCallId: "minted-fallback",
        toolName: "request_connection",
        input: { integration: "slack" },
      },
      index,
    );
    const ev = events[0] as any;
    assert.equal(ev.payload.toolCallId, "acp-real", "correlated id wins over the minted one");
    assert.equal(ev.payload.toolCall.id, "acp-real");
  });

  it("falls back to the minted id when the index has no match", () => {
    const { run, events } = collect();
    const index = createToolCallCorrelationIndex(); // empty
    emitClientToolInteraction(
      run,
      { id: "i-1", toolCallId: "minted", toolName: "request_connection", input: {} },
      index,
    );
    assert.equal((events[0] as any).payload.toolCallId, "minted");
  });
});

describe("buildClientToolRelay", () => {
  it("on pendingApproval: emits the interaction, marks the paused call, records it, returns pendingApproval", async () => {
    const s = seam({ kind: "pendingApproval" });
    const outcome = await s.relay.onClientTool(req);
    assert.equal(outcome, "pendingApproval");
    assert.equal(s.events.length, 1, "the interaction is emitted");
    const ev = s.events[0] as any;
    assert.equal(ev.kind, "client_tool");
    assert.equal(ev.id, "i-1");
    assert.deepEqual(ev.payload.render, { kind: "connect" });
    assert.deepEqual(s.pausedToolCalls, ["tc-1"], "the tool call is marked paused");
    assert.deepEqual(s.recorded, [
      { token: "i-1", toolName: "request_connection", kind: "client_tool" },
    ]);
    // onPause is the consumer's responsibility to call after a pendingApproval outcome
    // (relay loop / MCP handler); it delegates to the pause controller (the turn-ender).
    assert.equal(s.pauses(), 0);
    s.relay.onPause?.(req);
    assert.equal(s.pauses(), 1);
  });

  it("substitutes the correlated ACP id for the paused call and the payload (Claude)", async () => {
    const s = seam({ kind: "pendingApproval" }, { index: true });
    s.index!.record({
      sessionUpdate: "tool_call",
      toolCallId: "acp-real",
      title: "request_connection",
      rawInput: { integration: "slack" },
    });
    await s.relay.onClientTool(req);
    assert.deepEqual(
      s.pausedToolCalls,
      ["acp-real"],
      "the CORRELATED id is marked paused (suppresses Claude's late frames)",
    );
    assert.equal((s.events[0] as any).payload.toolCallId, "acp-real");
    assert.equal((s.events[0] as any).payload.toolCall.id, "acp-real");
  });

  it("latch already held: no second interaction, still pendingApproval", async () => {
    const s = seam({ kind: "pendingApproval" });
    assert.equal(await s.relay.onClientTool(req), "pendingApproval");
    assert.equal(await s.relay.onClientTool({ ...req, id: "i-2" }), "pendingApproval");
    assert.equal(s.events.length, 1, "only the first pending gate emits");
    assert.equal(s.recorded.length, 1);
  });

  it("does NOT emit when the responder fulfills (resume) or denies", async () => {
    const fulfilled = seam({ kind: "fulfilled", output: { connected: true } });
    assert.deepEqual(await fulfilled.relay.onClientTool(req), {
      output: { connected: true },
    });
    assert.equal(fulfilled.events.length, 0, "no interaction emitted on a resolved call");
    assert.deepEqual(fulfilled.pausedToolCalls, []);

    const denied = seam({ kind: "deny" });
    assert.equal(await denied.relay.onClientTool(req), "deny");
    assert.equal(denied.events.length, 0, "no interaction emitted on deny");
  });

  it("consumes the stored output (consume: true) and passes the client gate descriptor", async () => {
    const seen: Array<{ gate: unknown; opts: unknown }> = [];
    const relay = buildClientToolRelay({
      responder: {
        async onPermission() {
          return { kind: "deny" } as const;
        },
        async onClientTool(request, opts) {
          seen.push({ gate: request.gate, opts });
          return { kind: "deny" } as const;
        },
      },
      run: { emitEvent: () => {} },
      latch: new PendingApprovalLatch(),
      pause: { markPausedToolCall: () => {}, pause: () => {} },
      recordPendingInteraction: () => {},
    });
    await relay.onClientTool(req);
    assert.deepEqual(seen, [
      {
        gate: {
          executor: "client",
          toolName: "request_connection",
          specPermission: undefined,
          readOnlyHint: undefined,
          args: { integration: "slack" },
        },
        opts: { consume: true },
      },
    ]);
  });
});
