/**
 * Unit tests for the shared client-tool seam (engines/sandbox_agent/client-tools.ts):
 * the ACP tool-call correlation index, the single client_tool interaction payload, and
 * buildClientToolRelay (emits a widget per pending client tool + marks each paused call, returns
 * the responder's verdict as a relay outcome, and delegates onPause to the pause controller).
 *
 * Run: pnpm test (or: pnpm exec vitest run tests/unit/client-tools.test.ts)
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";

import type { AgentEvent } from "../../src/protocol.ts";
import type { ClientToolVerdict, Responder } from "../../src/responder.ts";
import type { ClientToolRelayRequest } from "../../src/tools/client-tool-relay.ts";
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
  });

  it("normalizes the mcp__<server>__ title prefix so a bare-name lookup hits (Claude ACP)", () => {
    // Claude's ACP adapter titles an internal-MCP tool `mcp__agenta-tools__<name>`, but
    // lookup() is called with the bare spec name — without normalization every lookup missed
    // and the minted UUID fallback always won (making suppression + widget attachment inert).
    const index = createToolCallCorrelationIndex();
    index.record({
      sessionUpdate: "tool_call",
      toolCallId: "acp-real-1",
      title: "mcp__agenta-tools__request_connection",
      rawInput: { integration: "slack" },
    });
    assert.equal(
      index.lookup("request_connection", { integration: "slack" }),
      "acp-real-1",
      "the prefixed title indexes under the bare name (args match)",
    );
  });

  it("prefix normalization survives a tool name that itself contains __", () => {
    const index = createToolCallCorrelationIndex();
    index.record({
      sessionUpdate: "tool_call",
      toolCallId: "acp-real-1",
      title: "mcp__agenta-tools__my__tool",
      rawInput: {},
    });
    assert.equal(
      index.lookup("my__tool", {}),
      "acp-real-1",
      "the lazy prefix strip ends at the FIRST __ after the server name",
    );
  });

  it("falls back to the bare name when the args differ", () => {
    const index = createToolCallCorrelationIndex();
    index.record({
      sessionUpdate: "tool_call",
      toolCallId: "acp-real-1",
      title: "request_connection",
      rawInput: { integration: "slack" },
    });
    assert.equal(
      index.lookup("request_connection", { integration: "github" }),
      "acp-real-1",
      "name fallback when args differ",
    );
  });

  it("consumes a matched id: two identical calls correlate to id-1 then id-2, then miss", () => {
    // First-write-wins would correlate a duplicate identical call to the FIRST call's ACP id
    // (already settled), mis-marking suppression. A match consumes its id instead (per-key FIFO,
    // symmetric with the client-output FIFO).
    const index = createToolCallCorrelationIndex();
    index.record({ sessionUpdate: "tool_call", toolCallId: "id-1", title: "t", rawInput: {} });
    index.record({ sessionUpdate: "tool_call", toolCallId: "id-2", title: "t", rawInput: {} });
    assert.equal(index.lookup("t", {}), "id-1", "first lookup takes the first id");
    assert.equal(index.lookup("t", {}), "id-2", "second lookup takes the second id");
    assert.equal(index.lookup("t", {}), undefined, "both consumed -> miss");
  });

  it("a consume via the args key also retires the id from the name queue", () => {
    const index = createToolCallCorrelationIndex();
    index.record({
      sessionUpdate: "tool_call",
      toolCallId: "id-1",
      title: "t",
      rawInput: { a: 1 },
    });
    assert.equal(index.lookup("t", { a: 1 }), "id-1", "consumed via name+args");
    assert.equal(
      index.lookup("t", { b: 2 }),
      undefined,
      "the name fallback must not resurrect a consumed id",
    );
  });

  it("ignores non-tool_call updates and re-sent frames for the same id", () => {
    const index = createToolCallCorrelationIndex();
    index.record({ sessionUpdate: "agent_message_chunk", text: "hi" });
    assert.equal(index.lookup("x", {}), undefined, "no record -> no id");
    index.record({ sessionUpdate: "tool_call", toolCallId: "id-1", title: "t" });
    index.record({ sessionUpdate: "tool_call", toolCallId: "id-1", title: "t" });
    assert.equal(index.lookup("t", {}), "id-1");
    assert.equal(index.lookup("t", {}), undefined, "a re-sent frame does not enqueue twice");
  });

  it("does NOT index under the ACP kind (a category, not a name)", () => {
    // `kind` is read/fetch/execute/other; indexing under it mis-correlated unrelated calls.
    const index = createToolCallCorrelationIndex();
    index.record({ sessionUpdate: "tool_call", toolCallId: "id-1", kind: "execute" });
    assert.equal(index.lookup("execute", {}), undefined, "kind-only frames are not indexed");
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

  it("emits exactly the id it is given (correlation is the relay's job, not the emitter's)", () => {
    // buildClientToolRelay resolves the correlated ACP id ONCE and passes it in; the emitter
    // has no index path of its own (the relay-level test below covers the substitution).
    const { run, events } = collect();
    emitClientToolInteraction(run, {
      id: "i-1",
      toolCallId: "already-correlated",
      toolName: "request_connection",
      input: {},
    });
    const ev = events[0] as any;
    assert.equal(ev.payload.toolCallId, "already-correlated");
    assert.equal(ev.payload.toolCall.id, "already-correlated");
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

  it("emits a widget for EACH pending client tool (several connections in one turn)", async () => {
    const s = seam({ kind: "pendingApproval" });
    assert.equal(await s.relay.onClientTool(req), "pendingApproval");
    assert.equal(
      await s.relay.onClientTool({
        ...req,
        id: "i-2",
        toolCallId: "tc-2",
        input: { integration: "github" },
      }),
      "pendingApproval",
    );
    assert.equal(
      s.events.length,
      2,
      "each pending client tool parks its own widget (not just the first)",
    );
    assert.equal(s.recorded.length, 2);
    assert.deepEqual(
      s.pausedToolCalls,
      ["tc-1", "tc-2"],
      "each parked call is marked so it is not force-settled as a deferred sibling",
    );
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
