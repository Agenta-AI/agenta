/**
 * Unit tests for the shared client-tool seam (engines/sandbox_agent/client-tools.ts):
 * the ACP tool-call correlation index, the single client_tool interaction payload, and
 * buildClientToolRelay (emits on park, returns the responder's decision, delegates onPark).
 *
 * Run: pnpm test (or: pnpm exec vitest run tests/unit/client-tools.test.ts)
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";

import type { AgentEvent } from "../../src/protocol.ts";
import type {
  ClientToolRelayRequest,
  Responder,
} from "../../src/responder.ts";
import {
  buildClientToolRelay,
  createToolCallCorrelationIndex,
  emitClientToolInteraction,
} from "../../src/engines/sandbox_agent/client-tools.ts";

const denyResponder: Responder = {
  async onPermission() {
    return "deny";
  },
  async onClientTool() {
    return "deny";
  },
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
  const req: ClientToolRelayRequest = {
    id: "i-1",
    toolCallId: "tc-1",
    toolName: "request_connection",
    input: { integration: "slack" },
    spec: { name: "request_connection", kind: "client", render: { kind: "connect" } },
  };

  it("emits the client_tool interaction on a park and returns park", async () => {
    const events: AgentEvent[] = [];
    let parkCalls = 0;
    const relay = buildClientToolRelay({
      responder: {
        async onPermission() {
          return "deny";
        },
        async onClientTool() {
          return "park";
        },
      },
      run: { emitEvent: (e) => events.push(e) },
      onPark: () => {
        parkCalls += 1;
      },
    });
    const decision = await relay.onClientTool(req);
    assert.equal(decision, "park");
    assert.equal(events.length, 1, "the interaction is emitted on park");
    assert.equal((events[0] as any).kind, "client_tool");
    assert.deepEqual((events[0] as any).payload.render, { kind: "connect" });
    // onPark is the consumer's responsibility to call after a park outcome (relay loop / MCP
    // handler), and it delegates to the engine turn-ender.
    relay.onPark?.(req);
    assert.equal(parkCalls, 1);
  });

  it("does NOT emit when the responder resolves the call (resume) or denies it", async () => {
    const events: AgentEvent[] = [];
    const resumeRelay = buildClientToolRelay({
      responder: {
        async onPermission() {
          return "deny";
        },
        async onClientTool() {
          return { output: { connected: true } };
        },
      },
      run: { emitEvent: (e) => events.push(e) },
      onPark: () => {},
    });
    const decision = await resumeRelay.onClientTool(req);
    assert.deepEqual(decision, { output: { connected: true } });
    assert.equal(events.length, 0, "no interaction emitted on a resolved call");

    const denyRelay = buildClientToolRelay({
      responder: denyResponder,
      run: { emitEvent: (e) => events.push(e) },
      onPark: () => {},
    });
    assert.equal(await denyRelay.onClientTool(req), "deny");
    assert.equal(events.length, 0, "no interaction emitted on deny");
  });
});
