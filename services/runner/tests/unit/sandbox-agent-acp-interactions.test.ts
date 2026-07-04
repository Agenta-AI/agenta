/**
 * Unit tests for sandbox-agent ACP interaction wiring.
 *
 * Run: pnpm test (or: pnpm exec vitest run tests/unit/sandbox-agent-acp-interactions.test.ts)
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";

import type { AgentEvent } from "../../src/protocol.ts";
import type { ClientToolVerdict, Responder } from "../../src/responder.ts";
import type { Verdict } from "../../src/permission-plan.ts";
import { PendingApprovalLatch } from "../../src/permission-plan.ts";
import { attachPermissionResponder } from "../../src/engines/sandbox_agent/acp-interactions.ts";

function flushPromises(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function makeSession(
  respondPermission: (id: string, reply: string) => Promise<void> | void = async () => {},
) {
  let handler: ((req: any) => void) | undefined;
  return {
    session: {
      onPermissionRequest(cb: (req: any) => void) {
        handler = cb;
      },
      respondPermission,
    },
    emit(req: any) {
      handler?.(req);
    },
  };
}

function fakeResponder(
  permissionVerdict: Verdict,
  clientVerdict: ClientToolVerdict = { kind: "deny" },
  seen: { permission?: any[]; client?: any[] } = {},
): Responder {
  seen.permission ??= [];
  seen.client ??= [];
  return {
    async onPermission(request) {
      seen.permission?.push(request);
      return permissionVerdict;
    },
    async onClientTool(request) {
      seen.client?.push(request);
      return clientVerdict;
    },
  };
}

describe("attachPermissionResponder", () => {
  it("allow verdict replies once and emits no interaction_request", async () => {
    const replies: Array<{ id: string; reply: string }> = [];
    const { session, emit } = makeSession(async (id, reply) => {
      replies.push({ id, reply });
    });
    const events: AgentEvent[] = [];
    const seen: { permission?: any[] } = {};

    attachPermissionResponder({
      session,
      run: { emitEvent: (event) => events.push(event) },
      responder: fakeResponder({ kind: "allow" }, undefined, seen),
      latch: new PendingApprovalLatch(),
    });
    emit({
      id: "perm-1",
      availableReplies: ["once", "always", "reject"],
      toolCall: { toolCallId: "tool-1", name: "edit", rawInput: { path: "a" } },
      options: { cwd: "/repo" },
    });
    await flushPromises();

    assert.deepEqual(replies, [{ id: "perm-1", reply: "once" }]);
    assert.deepEqual(events, []);
    assert.equal(seen.permission?.[0].gate.toolName, "edit");
    assert.equal(seen.permission?.[0].gate.executor, "harness");
    assert.deepEqual(seen.permission?.[0].gate.args, { path: "a" });
  });

  it("deny verdict replies reject and emits no interaction_request", async () => {
    const replies: Array<{ id: string; reply: string }> = [];
    const { session, emit } = makeSession(async (id, reply) => {
      replies.push({ id, reply });
    });
    const events: AgentEvent[] = [];

    attachPermissionResponder({
      session,
      run: { emitEvent: (event) => events.push(event) },
      responder: fakeResponder({ kind: "deny" }),
      latch: new PendingApprovalLatch(),
    });
    emit({ id: "perm-1", availableReplies: ["once", "reject"] });
    await flushPromises();

    assert.deepEqual(replies, [{ id: "perm-1", reply: "reject" }]);
    assert.deepEqual(events, []);
  });

  it("pendingApproval emits, creates the interaction, pauses, and sends no reply", async () => {
    const replies: Array<{ id: string; reply: string }> = [];
    const { session, emit } = makeSession(async (id, reply) => {
      replies.push({ id, reply });
    });
    const events: AgentEvent[] = [];
    const created: Array<{ token: string; toolName?: string; args: unknown }> = [];
    const pausedToolCalls: string[] = [];
    let pauses = 0;

    attachPermissionResponder({
      session,
      run: { emitEvent: (event) => events.push(event) },
      responder: fakeResponder({ kind: "pendingApproval" }),
      latch: new PendingApprovalLatch(),
      onPause: () => {
        pauses += 1;
      },
      onCreateInteraction: (token, toolName, args) => {
        created.push({ token, toolName, args });
      },
      onPausedToolCall: (id) => {
        pausedToolCalls.push(id);
      },
    });
    emit({
      id: "perm-pause",
      availableReplies: ["once", "always", "reject"],
      toolCall: { toolCallId: "tool-9", name: "edit", input: { path: "a" } },
      options: { cwd: "/repo" },
    });
    await flushPromises();

    assert.deepEqual(replies, []);
    assert.equal(pauses, 1);
    assert.deepEqual(pausedToolCalls, ["tool-9"]);
    assert.deepEqual(created, [
      { token: "perm-pause", toolName: "edit", args: { path: "a" } },
    ]);
    assert.deepEqual(events, [
      {
        type: "interaction_request",
        id: "perm-pause",
        kind: "user_approval",
        payload: {
          toolCallId: "tool-9",
          toolCall: { toolCallId: "tool-9", name: "edit", input: { path: "a" } },
          availableReplies: ["once", "always", "reject"],
          options: { cwd: "/repo" },
        },
      },
    ]);
  });

  it("two concurrent pending gates emit and pause only once through the latch", async () => {
    const { session, emit } = makeSession();
    const events: AgentEvent[] = [];
    let pauses = 0;

    attachPermissionResponder({
      session,
      run: { emitEvent: (event) => events.push(event) },
      responder: fakeResponder({ kind: "pendingApproval" }),
      latch: new PendingApprovalLatch(),
      onPause: () => {
        pauses += 1;
      },
    });
    emit({ id: "perm-1", toolCall: { toolCallId: "tool-1", name: "edit" } });
    emit({ id: "perm-2", toolCall: { toolCallId: "tool-2", name: "bash" } });
    await flushPromises();

    assert.equal(events.length, 1);
    assert.equal((events[0] as any).id, "perm-1");
    assert.equal(pauses, 1);
  });

  it("reply rejection pauses and does not resolve the interaction", async () => {
    const { session, emit } = makeSession(async () => {
      throw new Error("daemon closed");
    });
    const resolved: string[] = [];
    let pauses = 0;

    attachPermissionResponder({
      session,
      run: { emitEvent: () => {} },
      responder: fakeResponder({ kind: "allow" }),
      latch: new PendingApprovalLatch(),
      onPause: () => {
        pauses += 1;
      },
      onResolveInteraction: (token) => {
        resolved.push(token);
      },
    });
    emit({ id: "perm-1", availableReplies: ["once", "reject"] });
    await flushPromises();

    assert.equal(pauses, 1);
    assert.deepEqual(resolved, []);
  });

  it("missing ACP id takes the pause path with toolCallId as event id fallback", async () => {
    const replies: Array<{ id: string; reply: string }> = [];
    const { session, emit } = makeSession(async (id, reply) => {
      replies.push({ id, reply });
    });
    const events: AgentEvent[] = [];
    let pauses = 0;

    attachPermissionResponder({
      session,
      run: { emitEvent: (event) => events.push(event) },
      responder: fakeResponder({ kind: "allow" }),
      latch: new PendingApprovalLatch(),
      onPause: () => {
        pauses += 1;
      },
    });
    emit({
      availableReplies: ["once", "reject"],
      toolCall: { toolCallId: "tool-fallback", name: "edit" },
    });
    await flushPromises();

    assert.deepEqual(replies, []);
    assert.equal(pauses, 1);
    assert.equal(events.length, 1);
    assert.equal((events[0] as any).id, "tool-fallback");
  });

  it("client tool pending forwards to the browser, creates the interaction, and pauses", async () => {
    const replies: Array<{ id: string; reply: string }> = [];
    const { session, emit } = makeSession(async (id, reply) => {
      replies.push({ id, reply });
    });
    const events: AgentEvent[] = [];
    const pausedToolCalls: string[] = [];
    const created: Array<{ token: string; toolName?: string; args: unknown }> = [];
    let pauses = 0;

    attachPermissionResponder({
      session,
      run: { emitEvent: (event) => events.push(event) },
      responder: fakeResponder(
        { kind: "deny" },
        { kind: "pendingApproval" },
      ),
      latch: new PendingApprovalLatch(),
      onPause: () => {
        pauses += 1;
      },
      onCreateInteraction: (token, toolName, args) => {
        created.push({ token, toolName, args });
      },
      onPausedToolCall: (id) => {
        pausedToolCalls.push(id);
      },
    });
    emit({
      id: "client-1",
      availableReplies: ["once", "reject"],
      toolCall: {
        toolCallId: "tool-client",
        rawInput: { integration: "slack" },
        spec: {
          kind: "client",
          name: "request_connection",
          render: { kind: "component", component: "connect" },
        },
      },
    });
    await flushPromises();

    assert.deepEqual(replies, []);
    assert.equal(pauses, 1);
    assert.deepEqual(pausedToolCalls, ["tool-client"]);
    // A client-tool pause seeds the durable interactions plane exactly like a
    // user-approval pause: every pause leaves a row, whichever gate paused.
    assert.deepEqual(created, [
      {
        token: "client-1",
        toolName: "request_connection",
        args: { integration: "slack" },
      },
    ]);
    assert.deepEqual(events, [
      {
        type: "interaction_request",
        id: "client-1",
        kind: "client_tool",
        payload: {
          toolCallId: "tool-client",
          toolCall: {
            toolCallId: "tool-client",
            rawInput: { integration: "slack" },
            spec: {
              kind: "client",
              name: "request_connection",
              render: { kind: "component", component: "connect" },
            },
          },
          toolName: "request_connection",
          input: { integration: "slack" },
          render: { kind: "component", component: "connect" },
        },
      },
    ]);
  });

  it("client tool stored output replies instead of forwarding", async () => {
    const replies: Array<{ id: string; reply: string }> = [];
    const { session, emit } = makeSession(async (id, reply) => {
      replies.push({ id, reply });
    });
    const events: AgentEvent[] = [];

    attachPermissionResponder({
      session,
      run: { emitEvent: (event) => events.push(event) },
      responder: fakeResponder(
        { kind: "deny" },
        { kind: "fulfilled", output: { connected: true } },
      ),
      latch: new PendingApprovalLatch(),
    });
    emit({
      id: "client-1",
      availableReplies: ["once", "reject"],
      toolCall: {
        toolCallId: "tool-client",
        input: { integration: "slack" },
        spec: { kind: "client", name: "request_connection" },
      },
    });
    await flushPromises();

    assert.deepEqual(replies, [{ id: "client-1", reply: "once" }]);
    assert.deepEqual(events, []);
  });

  it("onResolveInteraction fires only after a successful reply", async () => {
    let releaseReply: (() => void) | undefined;
    const replies: Array<{ id: string; reply: string }> = [];
    const { session, emit } = makeSession(async (id, reply) => {
      replies.push({ id, reply });
      await new Promise<void>((resolve) => {
        releaseReply = resolve;
      });
    });
    const resolved: string[] = [];

    attachPermissionResponder({
      session,
      run: { emitEvent: () => {} },
      responder: fakeResponder({ kind: "allow" }),
      latch: new PendingApprovalLatch(),
      onResolveInteraction: (token) => {
        resolved.push(token);
      },
    });
    emit({ id: "perm-1", availableReplies: ["once", "reject"] });
    await flushPromises();

    assert.deepEqual(replies, [{ id: "perm-1", reply: "once" }]);
    assert.deepEqual(resolved, [], "reply is still pending");

    releaseReply?.();
    await flushPromises();
    assert.deepEqual(resolved, ["perm-1"]);
  });

  it("uses recorded tool_call name for harness gates without mutating the ACP object", async () => {
    const { session, emit } = makeSession();
    const seen: { permission?: any[] } = {};
    const toolCall = {
      toolCallId: "tool-1",
      title: "cat ~/.claude/settings.json",
      kind: "execute",
      rawInput: { command: "cat ~/.claude/settings.json" },
    };

    attachPermissionResponder({
      session,
      run: {
        emitEvent: () => {},
        events: () => [
          {
            type: "tool_call",
            id: "tool-1",
            name: "Terminal",
            input: { command: "cat ~/.claude/settings.json" },
          },
        ],
      },
      responder: fakeResponder({ kind: "allow" }, undefined, seen),
      latch: new PendingApprovalLatch(),
    });
    emit({ id: "perm-1", availableReplies: ["once", "reject"], toolCall });
    await flushPromises();

    assert.equal(seen.permission?.[0].gate.toolName, "Terminal");
    assert.equal((toolCall as any).resolvedName, undefined);
  });

  it("passes server-level MCP permissions into harness gates", async () => {
    const { session, emit } = makeSession();
    const seen: { permission?: any[] } = {};

    attachPermissionResponder({
      session,
      run: { emitEvent: () => {} },
      responder: fakeResponder({ kind: "pendingApproval" }, undefined, seen),
      latch: new PendingApprovalLatch(),
      serverPermissions: new Map([["github", "deny"]]),
    });
    emit({
      id: "perm-1",
      toolCall: { toolCallId: "tool-1", name: "mcp__github__search" },
    });
    await flushPromises();

    assert.equal(seen.permission?.[0].gate.serverPermission, "deny");
  });
});
