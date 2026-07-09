/**
 * Unit tests for sandbox-agent ACP interaction wiring.
 *
 * Run: pnpm test (or: pnpm exec vitest run tests/unit/sandbox-agent-acp-interactions.test.ts)
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";

import type { AgentEvent } from "../../src/protocol.ts";
import type { ClientToolVerdict, Responder } from "../../src/responder.ts";
import {
  ApprovalResponder,
  ConversationDecisions,
} from "../../src/responder.ts";
import type { PermissionPlan, Verdict } from "../../src/permission-plan.ts";
import { PendingApprovalLatch } from "../../src/permission-plan.ts";
import {
  attachPermissionResponder,
  type PiToolSpecMeta,
} from "../../src/engines/sandbox_agent/acp-interactions.ts";
import {
  buildPiGateEnvelope,
  PI_GATE_DIALOG_TITLE,
  type PiGateKind,
} from "../../src/engines/sandbox_agent/pi-gate-envelope.ts";

function flushPromises(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function makeSession(
  respondPermission: (
    id: string,
    reply: string,
  ) => Promise<void> | void = async () => {},
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
    const created: Array<{
      token: string;
      toolName?: string;
      args: unknown;
      kind: string;
    }> = [];
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
      onCreateInteraction: (token, toolName, args, kind) => {
        created.push({ token, toolName, args, kind });
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
      {
        token: "perm-pause",
        toolName: "edit",
        args: { path: "a" },
        kind: "user_approval",
      },
    ]);
    assert.deepEqual(events, [
      {
        type: "interaction_request",
        id: "perm-pause",
        kind: "user_approval",
        payload: {
          toolCallId: "tool-9",
          // a stamped COPY: the egress prefers resolvedName over drift-prone display fields
          toolCall: {
            toolCallId: "tool-9",
            name: "edit",
            input: { path: "a" },
            resolvedName: "edit",
          },
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
    const created: Array<{
      token: string;
      toolName?: string;
      args: unknown;
      kind: string;
    }> = [];
    let pauses = 0;

    attachPermissionResponder({
      session,
      run: { emitEvent: (event) => events.push(event) },
      responder: fakeResponder({ kind: "deny" }, { kind: "pendingApproval" }),
      latch: new PendingApprovalLatch(),
      onPause: () => {
        pauses += 1;
      },
      onCreateInteraction: (token, toolName, args, kind) => {
        created.push({ token, toolName, args, kind });
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
        kind: "client_tool",
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
            resolvedName: "request_connection",
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

// -------------------------------------------------------------------------- //
// Pi approval parking: a gate rides ctx.ui.confirm and arrives as an ACP      //
// permission request carrying the JSON envelope through rawInput.message.     //
// -------------------------------------------------------------------------- //

/** An ACP permission request the pi-acp bridge synthesizes from a `ctx.ui.confirm` dialog: a
 *  synthetic `pi-ui-<uuid>` tool-call id and the real gate identity tunneled through the message. */
function piGateRequest(opts: {
  gate: PiGateKind;
  toolName: string;
  toolCallId: string;
  input: unknown;
  message?: string;
  title?: string;
}) {
  const message =
    opts.message ??
    buildPiGateEnvelope({
      gate: opts.gate,
      toolName: opts.toolName,
      toolCallId: opts.toolCallId,
      input: opts.input,
    });
  return {
    id: "perm-pi",
    availableReplies: ["once", "reject"],
    toolCall: {
      toolCallId: "pi-ui-synthetic-uuid",
      kind: "other",
      status: "pending",
      title: opts.title ?? PI_GATE_DIALOG_TITLE,
      rawInput: { method: "confirm", title: PI_GATE_DIALOG_TITLE, message },
    },
  };
}

function permissionPlan(
  defaultMode: PermissionPlan["default"],
): PermissionPlan {
  return { default: defaultMode, rules: [] };
}

describe("attachPermissionResponder: Pi dialog gate", () => {
  it("normalizes the synthetic id to the envelope's REAL id everywhere it is read", async () => {
    const { session, emit } = makeSession();
    const events: AgentEvent[] = [];
    const pausedToolCalls: string[] = [];
    const gates: any[] = [];

    attachPermissionResponder({
      session,
      run: { emitEvent: (event) => events.push(event) },
      responder: fakeResponder({ kind: "pendingApproval" }),
      latch: new PendingApprovalLatch(),
      dialogGateEnabled: true,
      onPausedToolCall: (id) => pausedToolCalls.push(id),
      onUserApprovalGate: (info) => gates.push(info),
    });
    emit(
      piGateRequest({
        gate: "pi-custom-tool",
        toolName: "park_probe",
        toolCallId: "call_REAL_123",
        input: { token: "T" },
      }),
    );
    await flushPromises();

    // pause bookkeeping, the park record, and the emitted card ALL key on the real id.
    assert.deepEqual(pausedToolCalls, ["call_REAL_123"]);
    assert.equal(gates[0].toolCallId, "call_REAL_123");
    assert.equal(gates[0].gateType, "pi-dialog-permission");
    const payload = (events[0] as any).payload;
    assert.equal(payload.toolCallId, "call_REAL_123");
    assert.equal(payload.toolCall.toolCallId, "call_REAL_123");
    // the card shows the REAL args (resolvedName + rawInput), not the envelope JSON.
    assert.equal(payload.toolCall.resolvedName, "park_probe");
    assert.deepEqual(payload.toolCall.rawInput, { token: "T" });
  });

  it("a malformed envelope under the matching title rejects (fail closed), no pause", async () => {
    const replies: Array<{ id: string; reply: string }> = [];
    const { session, emit } = makeSession(async (id, reply) => {
      replies.push({ id, reply });
    });
    const events: AgentEvent[] = [];
    const created: unknown[] = [];
    let pauses = 0;

    attachPermissionResponder({
      session,
      run: { emitEvent: (event) => events.push(event) },
      // A default-allow responder: if the malformed request fell through it would ALLOW.
      responder: fakeResponder({ kind: "allow" }),
      latch: new PendingApprovalLatch(),
      dialogGateEnabled: true,
      onPause: () => {
        pauses += 1;
      },
      onCreateInteraction: (token) => created.push(token),
    });
    emit(
      piGateRequest({
        gate: "pi-custom-tool",
        toolName: "x",
        toolCallId: "c",
        input: {},
        message: "{ not valid json",
      }),
    );
    await flushPromises();

    assert.deepEqual(replies, [{ id: "perm-pi", reply: "reject" }]);
    assert.equal(pauses, 0, "a malformed gate never pauses");
    assert.deepEqual(events, [], "no interaction_request emitted");
    assert.deepEqual(
      created,
      [],
      "no durable interaction created for a rejected request",
    );
  });

  it("a non-matching dialog title is untouched (takes today's spec-less path)", async () => {
    const { session, emit } = makeSession();
    const seen: { permission?: any[] } = {};

    attachPermissionResponder({
      session,
      run: { emitEvent: () => {} },
      responder: fakeResponder({ kind: "pendingApproval" }, undefined, seen),
      latch: new PendingApprovalLatch(),
      dialogGateEnabled: true,
    });
    emit(
      piGateRequest({
        gate: "pi-custom-tool",
        toolName: "park_probe",
        toolCallId: "call_x",
        input: {},
        title: "not-agenta-approval",
      }),
    );
    await flushPromises();

    // Classified by the title (today's path), NOT by the envelope.
    assert.equal(seen.permission?.[0].gate.toolName, "not-agenta-approval");
  });

  it("recovers permission metadata so author-allow is instant-allow and author-deny instant-deny", async () => {
    const replies: Array<{ id: string; reply: string }> = [];
    const { session, emit } = makeSession(async (id, reply) => {
      replies.push({ id, reply });
    });
    const piToolSpecsByName = new Map<string, PiToolSpecMeta>([
      ["author_allow", { permission: "allow" }],
      ["author_deny", { permission: "deny" }],
    ]);
    const responder = new ApprovalResponder(
      permissionPlan("ask"),
      new ConversationDecisions(new Map()),
    );

    attachPermissionResponder({
      session,
      run: { emitEvent: () => {} },
      responder,
      latch: new PendingApprovalLatch(),
      dialogGateEnabled: true,
      piToolSpecsByName,
    });
    emit(
      piGateRequest({
        gate: "pi-custom-tool",
        toolName: "author_allow",
        toolCallId: "c1",
        input: {},
      }),
    );
    await flushPromises();
    assert.deepEqual(replies, [{ id: "perm-pi", reply: "once" }]);

    emit(
      piGateRequest({
        gate: "pi-custom-tool",
        toolName: "author_deny",
        toolCallId: "c2",
        input: {},
      }),
    );
    await flushPromises();
    assert.deepEqual(replies[1], { id: "perm-pi", reply: "reject" });
  });

  it("a read-only builtin auto-allows under allow_reads (no pause)", async () => {
    const replies: Array<{ id: string; reply: string }> = [];
    const { session, emit } = makeSession(async (id, reply) => {
      replies.push({ id, reply });
    });
    let pauses = 0;
    const responder = new ApprovalResponder(
      permissionPlan("allow_reads"),
      new ConversationDecisions(new Map()),
    );

    attachPermissionResponder({
      session,
      run: { emitEvent: () => {} },
      responder,
      latch: new PendingApprovalLatch(),
      dialogGateEnabled: true,
      onPause: () => {
        pauses += 1;
      },
    });
    emit(
      piGateRequest({
        gate: "pi-builtin",
        toolName: "read",
        toolCallId: "c",
        input: { path: "a" },
      }),
    );
    await flushPromises();

    assert.deepEqual(replies, [{ id: "perm-pi", reply: "once" }]);
    assert.equal(
      pauses,
      0,
      "a read-only builtin never pauses under allow_reads",
    );
  });

  it("a write builtin under allow_reads pauses for a human", async () => {
    const { session, emit } = makeSession();
    let pauses = 0;
    const gates: any[] = [];
    const responder = new ApprovalResponder(
      permissionPlan("allow_reads"),
      new ConversationDecisions(new Map()),
    );

    attachPermissionResponder({
      session,
      run: { emitEvent: () => {} },
      responder,
      latch: new PendingApprovalLatch(),
      dialogGateEnabled: true,
      onPause: () => {
        pauses += 1;
      },
      onUserApprovalGate: (info) => gates.push(info),
    });
    emit(
      piGateRequest({
        gate: "pi-builtin",
        toolName: "bash",
        toolCallId: "c",
        input: { command: "rm -rf /" },
      }),
    );
    await flushPromises();

    assert.equal(pauses, 1);
    assert.equal(gates[0].gateType, "pi-dialog-permission");
    assert.equal(gates[0].toolName, "Bash");
  });

  it("an unknown builtin name in the envelope rejects (fail closed, relay parity)", async () => {
    const replies: Array<{ id: string; reply: string }> = [];
    const { session, emit } = makeSession(async (id, reply) => {
      replies.push({ id, reply });
    });
    const events: AgentEvent[] = [];
    let pauses = 0;
    // A default-allow responder: if the fabricated name fell through it would ALLOW.
    const responder = fakeResponder({ kind: "allow" });

    attachPermissionResponder({
      session,
      run: { emitEvent: (event) => events.push(event) },
      responder,
      latch: new PendingApprovalLatch(),
      dialogGateEnabled: true,
      onPause: () => {
        pauses += 1;
      },
    });
    emit(
      piGateRequest({
        gate: "pi-builtin",
        toolName: "fabricated_tool",
        toolCallId: "c",
        input: {},
      }),
    );
    await flushPromises();

    assert.deepEqual(replies, [{ id: "perm-pi", reply: "reject" }]);
    assert.equal(pauses, 0, "an unknown builtin never pauses");
    assert.deepEqual(events, [], "no approval card for a fabricated name");
  });

  it("with detection OFF, a Claude gate whose title collides with the dialog title takes today's path", async () => {
    // The MF-1 regression: attachPermissionResponder is shared by Claude and Pi. With the
    // dialog gate off, a Claude gate titled literally "agenta-approval" (editing a file with
    // that name, a bash command equal to it) has no envelope and must pause/resolve exactly as
    // on the base path, never auto-reject.
    const replies: Array<{ id: string; reply: string }> = [];
    const { session, emit } = makeSession(async (id, reply) => {
      replies.push({ id, reply });
    });
    const events: AgentEvent[] = [];
    const gates: any[] = [];
    let pauses = 0;

    attachPermissionResponder({
      session,
      run: { emitEvent: (event) => events.push(event) },
      responder: fakeResponder({ kind: "pendingApproval" }),
      latch: new PendingApprovalLatch(),
      // dialogGateEnabled intentionally absent (flag off / Claude run).
      onPause: () => {
        pauses += 1;
      },
      onUserApprovalGate: (info) => gates.push(info),
    });
    emit({
      id: "perm-claude",
      availableReplies: ["once", "reject"],
      toolCall: {
        toolCallId: "tc-claude",
        title: PI_GATE_DIALOG_TITLE,
        kind: "execute",
        rawInput: { command: "cat agenta-approval" },
      },
    });
    await flushPromises();

    assert.deepEqual(replies, [], "never auto-rejected");
    assert.equal(pauses, 1, "paused exactly as the base path does");
    assert.equal(gates[0].gateType, "claude-acp-permission");
    assert.equal(events.length, 1, "the approval card was emitted");
    assert.equal((events[0] as any).payload.toolCallId, "tc-claude");
  });
});
