/**
 * Unit tests for sandbox-agent ACP interaction wiring.
 *
 * Run: pnpm test (or: pnpm exec vitest run tests/unit/sandbox-agent-acp-interactions.test.ts)
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type {
  AgentEvent,
  AgentRunRequest,
  ResolvedToolSpec,
} from "../../src/protocol.ts";
import { toolSpecsByName } from "../../src/tools/public-spec.ts";
import type { ClientToolVerdict, Responder } from "../../src/responder.ts";
import {
  ApprovalResponder,
  ConversationDecisions,
  extractApprovalDecisions,
} from "../../src/responder.ts";
import type { PermissionPlan, Verdict } from "../../src/permission-plan.ts";
import {
  attachPermissionResponder,
  type PiToolSpecMeta,
} from "../../src/engines/sandbox_agent/acp-interactions.ts";
import {
  buildApprovedContentWiring,
  createCommitAuthorizationState,
} from "../../src/engines/sandbox_agent/approved-content.ts";
import {
  buildPiGateEnvelope,
  PI_GATE_DIALOG_TITLE,
  type PiGateKind,
} from "../../src/engines/sandbox_agent/pi-gate-envelope.ts";

function flushPromises(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/** Wait for a condition the gate reaches asynchronously (it now awaits a late harness frame). */
async function waitUntil(
  predicate: () => boolean,
  timeoutMs = 2000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
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

/**
 * The run's real resolved specs, exactly as the engine indexes them. A real ACP tool-call NEVER
 * carries the spec inline — the runner resolves it by name from this map — so fixtures must set
 * the spec HERE and leave the emitted toolCall spec-less (see the realistic-shape tests below).
 */
function specsByName(specs: ResolvedToolSpec[]): Map<string, ResolvedToolSpec> {
  return toolSpecsByName(specs);
}

const CLIENT_SPEC: ResolvedToolSpec = {
  name: "request_connection",
  kind: "client",
  render: { kind: "component", component: "connect" },
};

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
    });
    emit({ id: "perm-1", availableReplies: ["once", "reject"] });
    await flushPromises();

    assert.deepEqual(replies, [{ id: "perm-1", reply: "reject" }]);
    assert.deepEqual(events, []);
  });

  it("deny verdict flags the gated tool-call id denied so its result renders a decline", async () => {
    const replies: Array<{ id: string; reply: string }> = [];
    const { session, emit } = makeSession(async (id, reply) => {
      replies.push({ id, reply });
    });
    const events: AgentEvent[] = [];
    const denied: Array<string | undefined> = [];

    attachPermissionResponder({
      session,
      run: {
        emitEvent: (event) => events.push(event),
        markToolCallDenied: (id) => denied.push(id),
      },
      responder: fakeResponder({ kind: "deny" }),
    });
    emit({
      id: "perm-1",
      availableReplies: ["once", "reject"],
      toolCall: { toolCallId: "tool-7", name: "edit", rawInput: { path: "a" } },
    });
    await flushPromises();

    assert.deepEqual(replies, [{ id: "perm-1", reply: "reject" }]);
    // The gate's tool-call id is flagged BEFORE the reject reply, keyed by the real toolCallId.
    assert.deepEqual(denied, ["tool-7"]);
  });

  it("allow verdict does NOT flag the tool-call id denied", async () => {
    const { session, emit } = makeSession(async () => {});
    const events: AgentEvent[] = [];
    const denied: Array<string | undefined> = [];

    attachPermissionResponder({
      session,
      run: {
        emitEvent: (event) => events.push(event),
        markToolCallDenied: (id) => denied.push(id),
      },
      responder: fakeResponder({ kind: "allow" }),
    });
    emit({
      id: "perm-1",
      availableReplies: ["once", "reject"],
      toolCall: { toolCallId: "tool-7", name: "edit", rawInput: { path: "a" } },
    });
    await flushPromises();

    assert.deepEqual(denied, []);
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
      toolCallId?: string;
    }> = [];
    const pausedToolCalls: string[] = [];
    let pauses = 0;

    attachPermissionResponder({
      session,
      run: { emitEvent: (event) => events.push(event) },
      responder: fakeResponder({ kind: "pendingApproval" }),
      onPause: () => {
        pauses += 1;
      },
      onCreateInteraction: (token, toolName, args, kind, toolCallId) => {
        created.push({ token, toolName, args, kind, toolCallId });
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
    // The interaction token is the permission GATE's id; `toolCallId` is the harness's id for
    // the gated call. Both are recorded so an answer built from the durable row alone can name
    // the right call (issue #5593).
    assert.deepEqual(created, [
      {
        token: "perm-pause",
        toolName: "edit",
        args: { path: "a" },
        kind: "user_approval",
        toolCallId: "tool-9",
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

  it("two concurrent pending gates each emit their own card and pause the turn once", async () => {
    const { session, emit } = makeSession();
    const events: AgentEvent[] = [];
    const gates: string[] = [];
    let pauses = 0;

    attachPermissionResponder({
      session,
      run: { emitEvent: (event) => events.push(event) },
      responder: fakeResponder({ kind: "pendingApproval" }),
      onPause: () => {
        pauses += 1;
      },
      onUserApprovalGate: (info) => {
        gates.push(info.toolCallId);
      },
    });
    emit({ id: "perm-1", toolCall: { toolCallId: "tool-1", name: "edit" } });
    emit({ id: "perm-2", toolCall: { toolCallId: "tool-2", name: "bash" } });
    await flushPromises();

    // No latch: each gate emits its own interaction_request card, keyed by its own tool-call id.
    assert.equal(events.length, 2);
    assert.deepEqual(
      events.map((e) => (e as any).id),
      ["perm-1", "perm-2"],
    );
    assert.deepEqual(
      events.map((e) => (e as any).payload.toolCallId),
      ["tool-1", "tool-2"],
    );
    // onPause fires once per gate at this layer; the shared PendingApprovalPauseController dedupes
    // to a single turn-end (asserted in pending-approval-pause.test.ts). Both gates signalled.
    assert.equal(pauses, 2);
    assert.deepEqual(gates, ["tool-1", "tool-2"]);
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
      toolCallId?: string;
    }> = [];
    let pauses = 0;

    attachPermissionResponder({
      session,
      run: { emitEvent: (event) => events.push(event) },
      responder: fakeResponder({ kind: "deny" }, { kind: "pendingApproval" }),
      toolSpecsByName: specsByName([CLIENT_SPEC]),
      onPause: () => {
        pauses += 1;
      },
      onCreateInteraction: (token, toolName, args, kind, toolCallId) => {
        created.push({ token, toolName, args, kind, toolCallId });
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
        title: "mcp__agenta-tools__request_connection",
        rawInput: { integration: "slack" },
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
        toolCallId: "tool-client",
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
            title: "mcp__agenta-tools__request_connection",
            rawInput: { integration: "slack" },
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
      toolSpecsByName: specsByName([CLIENT_SPEC]),
    });
    emit({
      id: "client-1",
      availableReplies: ["once", "reject"],
      toolCall: {
        toolCallId: "tool-client",
        title: "mcp__agenta-tools__request_connection",
        input: { integration: "slack" },
      },
    });
    await flushPromises();

    assert.deepEqual(replies, [{ id: "client-1", reply: "once" }]);
    assert.deepEqual(events, []);
  });

  // A replayed approval and a marker-carrying commit (execution-authorization.md 7.2)
  // -------------------------------------------------------------------------------------
  // A cold resume destroys the frozen bytes the human approved, but their `{approved: true}`
  // is still in the conversation. Answering the new gate with it spends the approval on bytes
  // nobody saw; the call then dies at the relay with `authorization_missing`, which shows the
  // user a failed commit instead of a second card.

  const COMMIT_ARGS = {
    workflow_revision: {
      base_revision_id: "rev-1",
      delta: {
        operations: [
          {
            operation: "add_item",
            target: ["parameters", "agent", "skills"],
            value: {
              name: "pdf",
              files: [
                {
                  path: "x.py",
                  content: { "@ag.file": ".agenta-imports/x.py" },
                },
              ],
            },
          },
        ],
      },
    },
  };

  /** The replayed conversation: the model's commit, and the human's answer to it. */
  function replayedApproval(): Map<string, unknown[]> {
    return extractApprovalDecisions({
      messages: [
        {
          role: "assistant",
          content: [
            {
              type: "tool_call",
              toolCallId: "tool-original",
              toolName: "commit_revision",
              input: COMMIT_ARGS,
            },
          ],
        },
        {
          role: "tool",
          content: [
            {
              type: "tool_result",
              toolCallId: "tool-original",
              output: { approved: true },
            },
          ],
        },
      ],
    } as AgentRunRequest);
  }

  /** A workspace with a real import root, and the approved-content wiring `runTurn` builds. */
  function coldWorkspace(permission: "ask" | "allow" = "ask") {
    const cwd = mkdtempSync(join(tmpdir(), "agenta-cold-resume-"));
    mkdirSync(join(cwd, ".agenta-imports"), { recursive: true });
    writeFileSync(join(cwd, ".agenta-imports", "x.py"), "print('fresh')\n");
    const state = createCommitAuthorizationState();
    const wiring = buildApprovedContentWiring({
      state,
      isDaytona: false,
      workspaceCwd: cwd,
      sandbox: undefined,
      callback: undefined,
      runContext: undefined,
      permissionPlan: permissionPlan(permission === "allow" ? "allow" : "ask"),
      toolSpecs: [
        {
          name: "commit_revision",
          kind: "callback",
          callRef: "tools.agenta.commit_revision",
          permission,
          readOnly: false,
        },
      ],
      turnId: "turn-1",
      sessionId: "session-1",
    });
    return { cwd, state, wiring };
  }

  /** The re-gate path reads a real file, so one macrotask is not enough to settle it. */
  async function waitFor(predicate: () => boolean): Promise<void> {
    const deadline = Date.now() + 2000;
    while (!predicate() && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }

  function emitCommitGate(emit: (req: unknown) => void) {
    emit({
      id: "permission-cold",
      availableReplies: ["once", "reject"],
      toolCall: {
        toolCallId: "tool-cold",
        name: "commit_revision",
        rawInput: COMMIT_ARGS,
      },
    });
  }

  it("a replayed approval does NOT answer a cold gate; it asks again from a fresh read", async () => {
    const { cwd, state, wiring } = coldWorkspace();
    try {
      const replies: Array<{ id: string; reply: string }> = [];
      const events: AgentEvent[] = [];
      const { session, emit } = makeSession(async (id, reply) => {
        replies.push({ id, reply });
      });

      attachPermissionResponder({
        session,
        run: { emitEvent: (event) => events.push(event) },
        responder: new ApprovalResponder(
          permissionPlan("ask"),
          new ConversationDecisions(replayedApproval()),
        ),
        toolSpecsByName: specsByName([
          { name: "commit_revision", permission: "ask", readOnly: false },
        ]),
        onResolveApprovedContent: wiring.onResolveApprovedContent,
        shouldRegateStaleApproval: wiring.shouldRegateStaleApproval,
      });
      emitCommitGate(emit);
      await waitFor(() => events.length > 0 || replies.length > 0);

      assert.deepEqual(replies, [], "the harness was never told the call is allowed");
      assert.equal(events.length, 1);
      const event = events[0] as {
        type: string;
        payload: { manifest?: { files: Array<{ digest: string }> } };
      };
      assert.equal(event.type, "interaction_request");
      assert.equal(
        event.payload.manifest?.files.length,
        1,
        "the new card is built from a fresh read, not from the old approval",
      );
      assert.equal(
        state.store.recordsFor("tool-cold").length,
        1,
        "and the record it mints is keyed to the NEW call",
      );
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("a LIVE resume still consumes its parked approval", async () => {
    // The narrow half. The environment survived, so the frozen bytes the human saw are still
    // held and the answer they gave still describes them.
    const { cwd, wiring } = coldWorkspace();
    try {
      await wiring.onResolveApprovedContent({
        toolName: "commit_revision",
        toolCallId: "tool-cold",
        args: COMMIT_ARGS,
      });
      const replies: Array<{ id: string; reply: string }> = [];
      const { session, emit } = makeSession(async (id, reply) => {
        replies.push({ id, reply });
      });

      attachPermissionResponder({
        session,
        run: { emitEvent: () => {} },
        responder: new ApprovalResponder(
          permissionPlan("ask"),
          new ConversationDecisions(replayedApproval()),
        ),
        toolSpecsByName: specsByName([
          { name: "commit_revision", permission: "ask", readOnly: false },
        ]),
        onResolveApprovedContent: wiring.onResolveApprovedContent,
        shouldRegateStaleApproval: wiring.shouldRegateStaleApproval,
      });
      emitCommitGate(emit);
      await flushPromises();

      assert.deepEqual(replies, [{ id: "permission-cold", reply: "once" }]);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("a POLICY allow is never re-gated, so the inline exception survives", async () => {
    // Contract section 4: an explicit `allow` is a positive statement by the policy owner, and
    // it resolves inline at the relay. Only a REPLAYED answer is in question here.
    const { cwd, wiring } = coldWorkspace("allow");
    try {
      const replies: Array<{ id: string; reply: string }> = [];
      const { session, emit } = makeSession(async (id, reply) => {
        replies.push({ id, reply });
      });

      attachPermissionResponder({
        session,
        run: { emitEvent: () => {} },
        responder: new ApprovalResponder(
          permissionPlan("allow"),
          new ConversationDecisions(new Map()),
        ),
        toolSpecsByName: specsByName([
          { name: "commit_revision", permission: "allow", readOnly: false },
        ]),
        onResolveApprovedContent: wiring.onResolveApprovedContent,
        shouldRegateStaleApproval: wiring.shouldRegateStaleApproval,
      });
      emitCommitGate(emit);
      await flushPromises();

      assert.deepEqual(replies, [{ id: "permission-cold", reply: "once" }]);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("resolves the original interaction token after a cold stored-decision reply", async () => {
    const decisions = extractApprovalDecisions({
      messages: [
        {
          role: "assistant",
          content: [
            {
              type: "tool_call",
              toolCallId: "tool-original",
              toolName: "edit",
              input: { path: "a.txt" },
            },
          ],
        },
        {
          role: "tool",
          content: [
            {
              type: "tool_result",
              toolCallId: "tool-original",
              output: {
                approved: true,
                interactionToken: "interaction-original",
              },
            },
          ],
        },
      ],
    } as AgentRunRequest);
    const responder = new ApprovalResponder(
      permissionPlan("ask"),
      new ConversationDecisions(decisions),
    );
    const replies: Array<{ id: string; reply: string }> = [];
    const resolved: Array<{
      token: string;
      verdict?: { approved: boolean; toolCallId: string };
    }> = [];
    const { session, emit } = makeSession(async (id, reply) => {
      replies.push({ id, reply });
    });

    attachPermissionResponder({
      session,
      run: { emitEvent: () => {} },
      responder,
      onResolveInteraction: (token, verdict) => {
        resolved.push({ token, verdict });
      },
    });
    emit({
      id: "permission-cold",
      availableReplies: ["once", "reject"],
      toolCall: {
        toolCallId: "tool-cold",
        name: "edit",
        rawInput: { path: "a.txt" },
      },
    });
    await flushPromises();

    assert.deepEqual(replies, [{ id: "permission-cold", reply: "once" }]);
    assert.deepEqual(resolved, [
      {
        token: "interaction-original",
        verdict: { approved: true, toolCallId: "tool-cold" },
      },
    ]);
  });

  it("passes the approval verdict when resolving a previously created gate", async () => {
    const { session, emit } = makeSession();
    let permissionCalls = 0;
    const resolved: Array<{
      token: string;
      verdict?: { approved: boolean; toolCallId: string };
    }> = [];

    attachPermissionResponder({
      session,
      run: { emitEvent: () => {} },
      responder: {
        async onPermission() {
          permissionCalls += 1;
          return permissionCalls === 1
            ? ({ kind: "pendingApproval" } as const)
            : ({ kind: "deny" } as const);
        },
        async onClientTool() {
          return { kind: "deny" } as const;
        },
      },
      onResolveInteraction: (token, verdict) => {
        resolved.push({ token, verdict });
      },
    });
    const request = {
      id: "approval-1",
      availableReplies: ["once", "reject"],
      toolCall: { toolCallId: "tool-1", name: "bash" },
    };
    emit(request);
    await flushPromises();
    emit(request);
    await flushPromises();

    assert.deepEqual(resolved, [
      {
        token: "approval-1",
        verdict: { approved: false, toolCallId: "tool-1" },
      },
    ]);
  });

  it("resolves a client-tool row without an approval verdict", async () => {
    const replies: Array<{ id: string; reply: string }> = [];
    const { session, emit } = makeSession(async (id, reply) => {
      replies.push({ id, reply });
    });
    let clientCalls = 0;
    const resolved: Array<{
      token: string;
      verdict?: { approved: boolean; toolCallId: string };
    }> = [];

    attachPermissionResponder({
      session,
      run: { emitEvent: () => {} },
      responder: {
        async onPermission() {
          return { kind: "deny" } as const;
        },
        async onClientTool() {
          clientCalls += 1;
          return clientCalls === 1
            ? ({ kind: "pendingApproval" } as const)
            : ({ kind: "fulfilled", output: { connected: true } } as const);
        },
      },
      toolSpecsByName: specsByName([CLIENT_SPEC]),
      onResolveInteraction: (token, verdict) => {
        resolved.push({ token, verdict });
      },
    });
    const request = {
      id: "client-1",
      availableReplies: ["once", "reject"],
      toolCall: {
        toolCallId: "tool-client",
        name: "request_connection",
        input: { integration: "slack" },
      },
    };
    emit(request);
    await flushPromises();
    emit(request);
    await flushPromises();

    assert.deepEqual(replies, [{ id: "client-1", reply: "once" }]);
    assert.deepEqual(resolved, [{ token: "client-1", verdict: undefined }]);
  });

  it("onResolveInteraction never fires for an auto-allowed gate (no durable row exists)", async () => {
    // Only a PAUSED gate creates a durable interaction row. An auto-allowed gate replies to
    // the harness without ever creating one, so resolving its id would 404 against the
    // interactions plane. The responder must therefore stay silent on onResolveInteraction
    // for the auto-allow path; the live resume path resolves parked rows explicitly in the
    // engine instead.
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
    assert.deepEqual(
      resolved,
      [],
      "an auto-allowed gate created no row, so nothing must be resolved",
    );
  });

  it("a paused gate creates a durable row (the one onResolveInteraction may later resolve)", async () => {
    const { session, emit } = makeSession();
    const created: string[] = [];
    const resolved: string[] = [];

    attachPermissionResponder({
      session,
      run: { emitEvent: () => {} },
      responder: fakeResponder({ kind: "pendingApproval" }),
      onCreateInteraction: (token) => {
        created.push(token);
      },
      onResolveInteraction: (token) => {
        resolved.push(token);
      },
    });
    emit({ id: "perm-2", availableReplies: ["once", "reject"] });
    await flushPromises();

    // The pause creates the row and sends no reply; resolution belongs to the resume path.
    assert.deepEqual(created, ["perm-2"]);
    assert.deepEqual(resolved, []);
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
    });
    emit({ id: "perm-1", availableReplies: ["once", "reject"], toolCall });
    await flushPromises();

    assert.equal(seen.permission?.[0].gate.toolName, "Terminal");
    assert.equal((toolCall as any).resolvedName, undefined);
  });

  // ---------------------------------------------------------------------- //
  // RUN-ACPSPEC-1. A REAL ACP tool-call carries no spec: the harness sends    //
  // toolCallId + an mcp__<server>__<tool> title + rawInput, and nothing else. //
  // The runner must resolve the tool's true permission/readOnly by NAME from  //
  // the run's resolved specs — the same index the relay execution guard uses. //
  // The old fixtures set `toolCall.spec` inline (a field production never     //
  // writes), which is exactly what hid this from the suite.                   //
  // ---------------------------------------------------------------------- //

  it("resolves the REAL spec permission for a spec-less (realistically-shaped) ACP tool call", async () => {
    const { session, emit } = makeSession();
    const seen: { permission?: any[] } = {};

    attachPermissionResponder({
      session,
      run: { emitEvent: () => {} },
      responder: fakeResponder({ kind: "pendingApproval" }, undefined, seen),
      toolSpecsByName: specsByName([
        { name: "commit_revision", permission: "ask", readOnly: false },
      ]),
    });
    // Exactly what Claude's ACP adapter sends: NO spec/toolSpec/resolvedTool/tool field.
    emit({
      id: "perm-1",
      availableReplies: ["once", "reject"],
      toolCall: {
        toolCallId: "tool-1",
        title: "mcp__agenta-tools__commit_revision",
        rawInput: { message: "ship it" },
      },
    });
    await flushPromises();

    const gate = seen.permission?.[0].gate;
    // The card now names the tool by its bare spec name and carries its TRUE policy.
    assert.equal(gate.toolName, "commit_revision");
    assert.equal(gate.executor, "relay");
    assert.equal(gate.specPermission, "ask");
    assert.equal(gate.readOnlyHint, false);
  });

  it("a WRITE tool is never shown as read-only just because the plan default is permissive", async () => {
    // The human-facing defect: with no spec resolved, a mutating tool inherited the plan
    // default and the approval card implied it was safe. The card must reflect the tool.
    const { session, emit } = makeSession();
    const seen: { permission?: any[] } = {};

    attachPermissionResponder({
      session,
      run: { emitEvent: () => {} },
      responder: fakeResponder({ kind: "pendingApproval" }, undefined, seen),
      toolSpecsByName: specsByName([
        { name: "delete_everything", permission: "deny", readOnly: false },
      ]),
    });
    emit({
      id: "perm-1",
      availableReplies: ["once", "reject"],
      toolCall: {
        toolCallId: "tool-1",
        title: "mcp__agenta-tools__delete_everything",
        rawInput: { scope: "all" },
      },
    });
    await flushPromises();

    const gate = seen.permission?.[0].gate;
    assert.equal(gate.specPermission, "deny");
    assert.equal(
      gate.readOnlyHint,
      false,
      "a mutating tool must never reach the card as read-only",
    );
  });

  it("an unresolved tool name still takes the harness path (no spec invented)", async () => {
    // A builtin (Read/Bash/...) has no resolved spec: it must stay `harness`, with no
    // specPermission fabricated for it.
    const { session, emit } = makeSession();
    const seen: { permission?: any[] } = {};

    attachPermissionResponder({
      session,
      run: { emitEvent: () => {} },
      responder: fakeResponder({ kind: "pendingApproval" }, undefined, seen),
      toolSpecsByName: specsByName([
        { name: "commit_revision", permission: "ask" },
      ]),
    });
    emit({
      id: "perm-1",
      availableReplies: ["once", "reject"],
      toolCall: {
        toolCallId: "tool-1",
        name: "Bash",
        rawInput: { command: "ls" },
      },
    });
    await flushPromises();

    const gate = seen.permission?.[0].gate;
    assert.equal(gate.toolName, "Bash");
    assert.equal(gate.executor, "harness");
    assert.equal(gate.specPermission, undefined);
  });

  it("passes server-level MCP permissions into harness gates", async () => {
    const { session, emit } = makeSession();
    const seen: { permission?: any[] } = {};

    attachPermissionResponder({
      session,
      run: { emitEvent: () => {} },
      responder: fakeResponder({ kind: "pendingApproval" }, undefined, seen),
      serverPermissions: new Map([["github", "deny"]]),
    });
    emit({
      id: "perm-1",
      toolCall: { toolCallId: "tool-1", name: "mcp__github__search" },
    });
    await flushPromises();

    assert.equal(seen.permission?.[0].gate.serverPermission, "deny");
  });

  it("passes server-level MCP permissions into Codex dot-form harness gates", async () => {
    const { session, emit } = makeSession();
    const seen: { permission?: any[] } = {};

    attachPermissionResponder({
      session,
      run: { emitEvent: () => {} },
      responder: fakeResponder({ kind: "pendingApproval" }, undefined, seen),
      serverPermissions: new Map([["github", "deny"]]),
    });
    emit({
      id: "perm-1",
      toolCall: { toolCallId: "tool-1", name: "mcp.github.search" },
    });
    await flushPromises();

    assert.equal(seen.permission?.[0].gate.serverPermission, "deny");
  });
});

describe("attachPermissionResponder: Codex ACP gates", () => {
  it("classifies and parks a Codex exec gate by command", async () => {
    const { session, emit } = makeSession();
    const seen: { permission?: any[] } = {};
    const events: AgentEvent[] = [];
    const gates: any[] = [];

    attachPermissionResponder({
      session,
      run: {
        emitEvent: (event) => events.push(event),
        events: () => [
          {
            type: "tool_call",
            id: "exec-1",
            name: "pnpm test",
            input: { command: "pnpm test", cwd: "/workspace" },
          },
        ],
      },
      responder: fakeResponder({ kind: "pendingApproval" }, undefined, seen),
      acpAgent: "codex",
      onUserApprovalGate: (info) => gates.push(info),
    });
    emit({
      id: "perm-exec",
      availableReplies: ["once", "always", "reject"],
      options: [
        { optionId: "allow_once", kind: "allow_once" },
        { optionId: "allow_always", kind: "allow_always" },
        {
          optionId: "accept_execpolicy_amendment",
          kind: "allow_always",
        },
        { optionId: "reject_once", kind: "reject_once" },
      ],
      toolCall: {
        kind: "execute",
        rawInput: { command: "pnpm test", cwd: "/workspace" },
        status: "pending",
        toolCallId: "exec-1",
      },
    });
    await flushPromises();

    assert.deepEqual(seen.permission?.[0].gate, {
      executor: "harness",
      toolName: "pnpm test",
      specPermission: undefined,
      serverPermission: undefined,
      readOnlyHint: undefined,
      args: { command: "pnpm test", cwd: "/workspace" },
    });
    assert.equal(gates[0].gateType, "codex-acp-permission");
    assert.equal((events[0] as any).payload.toolCall.resolvedName, "pnpm test");
  });

  it("waits for the tool_call frame Codex sends AFTER the approval", async () => {
    // THE ORDERING, WHICH IS THE WHOLE BUG. Codex sends the permission request BEFORE the
    // `tool_call` frame carrying the arguments; on the preview stack the gap was 28 ms and the
    // gate ran first every time. The sibling test above feeds the recorded event synchronously,
    // so it can never see this: it proves the RECOVERY works once the frame exists, not that the
    // gate waits for it.
    //
    // With no wait, `gate.args` is undefined here, `markersIn(undefined)` finds nothing,
    // `mintForGate` mints no authorization, and the human approves a commit that can only fail.
    const { session, emit } = makeSession();
    const events: AgentEvent[] = [];
    const recorded: AgentEvent[] = [];
    const seen: { permission?: any[] } = {};
    const recordedInput = {
      server: "agenta-tools",
      tool: "commit_revision",
      arguments: { workflow_revision: { message: "ship it" } },
    };

    attachPermissionResponder({
      session,
      run: {
        emitEvent: (event) => events.push(event),
        events: () => recorded,
      },
      responder: fakeResponder({ kind: "pendingApproval" }, undefined, seen),
      acpAgent: "codex",
      toolSpecsByName: specsByName([
        { name: "commit_revision", permission: "ask", readOnly: false },
      ]),
    });

    // The gate arrives with NOTHING: no rawInput, no input, and no recorded event yet.
    emit({
      id: "perm-codex-race",
      _meta: { is_mcp_tool_approval: true },
      availableReplies: ["once", "reject"],
      toolCall: { toolCallId: "exec-race-1", kind: "execute" },
    });

    // The frame lands after the gate is already running, which is the production ordering.
    await new Promise((resolve) => setTimeout(resolve, 30));
    recorded.push({
      type: "tool_call",
      id: "exec-race-1",
      name: "mcp.agenta-tools.commit_revision",
      input: recordedInput,
    } as AgentEvent);

    await waitUntil(() => (seen.permission?.length ?? 0) > 0);

    assert.deepEqual(
      seen.permission?.[0].gate.args,
      recordedInput.arguments,
      "the gate must carry the arguments the model actually wrote",
    );
  });

  it("proceeds without arguments when the frame never arrives, rather than hanging", async () => {
    // Fail-open, deliberately. A HITL gate that hangs is worse than one that asks about a call it
    // cannot fully describe, so the wait is bounded and the gate still reaches the human.
    const { session, emit } = makeSession();
    const logs: string[] = [];
    const seen: { permission?: any[] } = {};

    attachPermissionResponder({
      session,
      run: { emitEvent: () => {}, events: () => [] },
      responder: fakeResponder({ kind: "pendingApproval" }, undefined, seen),
      acpAgent: "codex",
      log: (message) => logs.push(message),
      toolSpecsByName: specsByName([
        { name: "commit_revision", permission: "ask", readOnly: false },
      ]),
    });

    emit({
      id: "perm-codex-never",
      _meta: { is_mcp_tool_approval: true },
      availableReplies: ["once", "reject"],
      toolCall: { toolCallId: "exec-never-1", kind: "execute" },
    });

    await waitUntil(() => (seen.permission?.length ?? 0) > 0, 3000);

    assert.equal(seen.permission?.[0].gate.args, undefined);
    assert.ok(
      logs.some((line) => line.includes("no recorded tool_call arguments")),
      "the timeout is announced, not inferred from a later authorization failure",
    );
  });

  it("recovers a nearly-empty Codex MCP gate and parks an ask spec", async () => {
    const replies: Array<{ id: string; reply: string }> = [];
    const { session, emit } = makeSession(async (id, reply) => {
      replies.push({ id, reply });
    });
    const events: AgentEvent[] = [];
    const gates: any[] = [];
    const recordedInput = {
      server: "agenta-tools",
      tool: "commit_revision",
      arguments: { message: "ship it" },
    };

    attachPermissionResponder({
      session,
      run: {
        emitEvent: (event) => events.push(event),
        events: () => [
          {
            type: "tool_call",
            id: "exec-mcp-1",
            name: "mcp.agenta-tools.commit_revision",
            input: recordedInput,
          },
        ],
      },
      responder: new ApprovalResponder(
        { default: "allow", rules: [] },
        new ConversationDecisions(new Map()),
      ),
      acpAgent: "codex",
      toolSpecsByName: specsByName([
        { name: "commit_revision", permission: "ask", readOnly: false },
      ]),
      onUserApprovalGate: (info) => gates.push(info),
    });
    emit({
      id: "perm-mcp",
      _meta: { is_mcp_tool_approval: true },
      availableReplies: ["once", "always", "reject"],
      options: [
        { optionId: "allow_once", kind: "allow_once" },
        { optionId: "allow_session", kind: "allow_always" },
        { optionId: "allow_always", kind: "allow_always" },
        { optionId: "decline", kind: "reject_once" },
      ],
      toolCall: {
        kind: "execute",
        status: "pending",
        toolCallId: "exec-mcp-1",
      },
    });
    await flushPromises();

    assert.deepEqual(replies, []);
    assert.equal(gates[0].gateType, "codex-acp-permission");
    assert.equal(gates[0].toolName, "commit_revision");
    assert.deepEqual(gates[0].args, recordedInput.arguments);
    const parkedToolCall = (events[0] as any).payload.toolCall;
    assert.equal(parkedToolCall.resolvedName, "commit_revision");
    assert.deepEqual(parkedToolCall.rawInput, recordedInput.arguments);
  });

  it("unwraps the Codex MCP envelope so the gate can see @ag.file markers", async () => {
    // The bug Mahmoud hit three times. Codex records an MCP tool_call's input as the JSON-RPC
    // envelope `{tool, server, arguments}`; Claude records the arguments directly. Everything
    // downstream reads the Claude shape -- `findAllMarkers` looks for
    // `workflow_revision.delta.operations` at the TOP level. Handed the envelope it finds no
    // markers, mints no authorization, and the commit the human just approved dies with
    // `authorization_missing` while the model reports plain success.
    const { session, emit } = makeSession();
    const seen: { permission?: any[] } = {};
    const modelArgs = {
      description: "Add the saved gstack-autoplan skill.",
      workflow_revision: {
        base_revision_id: "rev-1",
        delta: {
          operations: [
            {
              operation: "add_item",
              target: ["parameters", "agent", "skills"],
              value: {
                name: "gstack-autoplan",
                body: { "@ag.file": ".agenta-imports/gstack-autoplan/SKILL.md" },
              },
            },
          ],
        },
      },
    };

    attachPermissionResponder({
      session,
      run: {
        emitEvent: () => {},
        events: () => [
          {
            type: "tool_call",
            id: "exec-envelope-1",
            name: "mcp.agenta-tools.commit_revision",
            input: {
              server: "agenta-tools",
              tool: "commit_revision",
              arguments: modelArgs,
            },
          } as AgentEvent,
        ],
      },
      responder: fakeResponder({ kind: "pendingApproval" }, undefined, seen),
      acpAgent: "codex",
      toolSpecsByName: specsByName([
        { name: "commit_revision", permission: "ask", readOnly: false },
      ]),
    });

    emit({
      id: "perm-envelope",
      _meta: { is_mcp_tool_approval: true },
      availableReplies: ["once", "reject"],
      toolCall: { toolCallId: "exec-envelope-1", kind: "execute" },
    });

    await waitUntil(() => (seen.permission?.length ?? 0) > 0);

    const args = seen.permission?.[0].gate.args as Record<string, unknown>;
    assert.deepEqual(args, modelArgs);
    assert.ok(
      (args as any).workflow_revision?.delta?.operations,
      "the marker scan reads workflow_revision at the TOP level, so the envelope must be gone",
    );
  });

  it("leaves a non-envelope argument object alone", async () => {
    // The unwrap keys off the exact `{tool, server, arguments}` shape. A tool whose OWN
    // arguments happen to include a `tool` field must not be mistaken for an envelope.
    const { session, emit } = makeSession();
    const seen: { permission?: any[] } = {};
    const modelArgs = { tool: "hammer", server: "warehouse", quantity: 2 };

    attachPermissionResponder({
      session,
      run: {
        emitEvent: () => {},
        events: () => [
          {
            type: "tool_call",
            id: "exec-lookalike-1",
            name: "mcp.agenta-tools.commit_revision",
            input: modelArgs,
          } as AgentEvent,
        ],
      },
      responder: fakeResponder({ kind: "pendingApproval" }, undefined, seen),
      acpAgent: "codex",
      toolSpecsByName: specsByName([
        { name: "commit_revision", permission: "ask", readOnly: false },
      ]),
    });

    emit({
      id: "perm-lookalike",
      _meta: { is_mcp_tool_approval: true },
      availableReplies: ["once", "reject"],
      toolCall: { toolCallId: "exec-lookalike-1", kind: "execute" },
    });

    await waitUntil(() => (seen.permission?.length ?? 0) > 0);
    assert.deepEqual(seen.permission?.[0].gate.args, modelArgs);
  });

  it("recovers a Codex MCP gate and auto-allows an allow spec once", async () => {
    const replies: Array<{ id: string; reply: string }> = [];
    const { session, emit } = makeSession(async (id, reply) => {
      replies.push({ id, reply });
    });
    let pauses = 0;

    attachPermissionResponder({
      session,
      run: {
        emitEvent: () => {},
        events: () => [
          {
            type: "tool_call",
            id: "exec-mcp-2",
            name: "mcp.agenta-tools.read_revision",
            input: {
              server: "agenta-tools",
              tool: "read_revision",
              arguments: { revisionId: "rev-1" },
            },
          },
        ],
      },
      responder: new ApprovalResponder(
        { default: "ask", rules: [] },
        new ConversationDecisions(new Map()),
      ),
      acpAgent: "codex",
      toolSpecsByName: specsByName([
        { name: "read_revision", permission: "allow", readOnly: true },
      ]),
      onPause: () => {
        pauses += 1;
      },
    });
    emit({
      id: "perm-mcp-allow",
      rawRequest: { _meta: { is_mcp_tool_approval: true } },
      availableReplies: ["once", "always", "reject"],
      toolCall: {
        kind: "execute",
        status: "pending",
        toolCallId: "exec-mcp-2",
      },
    });
    await flushPromises();

    assert.deepEqual(replies, [{ id: "perm-mcp-allow", reply: "once" }]);
    assert.equal(pauses, 0);
  });

  it("grants an execution for an allowed runner-executed tool, BEFORE replying to the harness", async () => {
    // The same call reaches the runner twice: here at the harness gate, then at the loopback
    // `agenta-tools` MCP seam. The grant is what stops the seam prompting the human a second
    // time, and it has to exist before the reply, because the reply releases the tool call.
    const order: string[] = [];
    const granted: Array<{ toolName: string | undefined; args: unknown }> = [];
    const { session, emit } = makeSession(async () => {
      order.push("reply");
    });
    const mcpArgs = {
      server: "agenta-tools",
      tool: "read_revision",
      arguments: { revisionId: "rev-1" },
    };

    attachPermissionResponder({
      session,
      run: {
        emitEvent: () => {},
        events: () => [
          {
            type: "tool_call",
            id: "exec-mcp-3",
            name: "mcp.agenta-tools.read_revision",
            input: mcpArgs,
          } as any,
        ],
      },
      responder: new ApprovalResponder(
        { default: "ask", rules: [] },
        new ConversationDecisions(new Map()),
      ),
      acpAgent: "codex",
      toolSpecsByName: specsByName([
        { name: "read_revision", permission: "allow", readOnly: true },
      ]),
      onExecutableGateAllowed: (info) => {
        order.push("grant");
        granted.push(info);
      },
    });
    emit({
      id: "perm-mcp-grant",
      _meta: { is_mcp_tool_approval: true },
      availableReplies: ["once", "always", "reject"],
      toolCall: {
        kind: "execute",
        status: "pending",
        toolCallId: "exec-mcp-3",
      },
    });
    await flushPromises();

    assert.deepEqual(order, ["grant", "reply"]);
    // The grant carries the tool's OWN arguments, not the MCP envelope: the relay guard matches
    // this against what the tool is actually called with.
    assert.deepEqual(granted, [
      { toolName: "read_revision", args: mcpArgs.arguments },
    ]);
  });

  it("does not grant an execution for a harness builtin, which never reaches the seam", async () => {
    const granted: unknown[] = [];
    const { session, emit } = makeSession();

    attachPermissionResponder({
      session,
      run: { emitEvent: () => {} },
      responder: fakeResponder({ kind: "allow" }),
      acpAgent: "codex",
      onExecutableGateAllowed: (info) => granted.push(info),
    });
    emit({
      id: "perm-shell",
      availableReplies: ["once", "reject"],
      toolCall: {
        kind: "execute",
        toolCallId: "shell-1",
        rawInput: { command: "ls" },
      },
    });
    await flushPromises();

    assert.deepEqual(granted, []);
  });

  it("does not grant an execution when the gate parks or is denied", async () => {
    for (const verdict of [
      { kind: "pendingApproval" },
      { kind: "deny" },
    ] as const) {
      const granted: unknown[] = [];
      const { session, emit } = makeSession();

      attachPermissionResponder({
        session,
        run: { emitEvent: () => {} },
        responder: fakeResponder(verdict),
        acpAgent: "codex",
        toolSpecsByName: specsByName([
          { name: "read_revision", permission: "ask", readOnly: true },
        ]),
        onExecutableGateAllowed: (info) => granted.push(info),
      });
      emit({
        id: "perm-mcp-parked",
        availableReplies: ["once", "reject"],
        toolCall: {
          kind: "execute",
          toolCallId: "exec-mcp-4",
          name: "read_revision",
          rawInput: { revisionId: "rev-1" },
        },
      });
      await flushPromises();

      assert.deepEqual(granted, [], `verdict ${verdict.kind} must not grant`);
    }
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
      rawInput: {
        method: "confirm",
        title: opts.title ?? PI_GATE_DIALOG_TITLE,
        message,
      },
    },
  };
}

function permissionPlan(
  defaultMode: PermissionPlan["default"],
): PermissionPlan {
  return { default: defaultMode, rules: [] };
}

/** The resolved-specs map that marks a Pi run and feeds metadata recovery. Every custom tool a
 *  test raises must be present: an unknown name fails closed by design. */
function piSpecs(
  entries: Array<[string, PiToolSpecMeta]> = [
    ["park_probe", {}],
    ["x", {}],
  ],
): Map<string, PiToolSpecMeta> {
  return new Map(entries);
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
      piToolSpecsByName: piSpecs(),
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
    assert.equal(gates[0].gateType, "pi-acp-permission");
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
      piToolSpecsByName: piSpecs(),
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
      piToolSpecsByName: piSpecs(),
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
      piToolSpecsByName: piSpecs(),
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
      piToolSpecsByName: piSpecs(),
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
    assert.equal(gates[0].gateType, "pi-acp-permission");
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
      piToolSpecsByName: piSpecs(),
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

  it("an unknown custom-tool name (no resolved spec) rejects (fail closed)", async () => {
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
      piToolSpecsByName: piSpecs([["park_probe", {}]]),
    });
    emit(
      piGateRequest({
        gate: "pi-custom-tool",
        toolName: "not_a_resolved_tool",
        toolCallId: "c",
        input: {},
      }),
    );
    await flushPromises();

    assert.deepEqual(replies, [{ id: "perm-pi", reply: "reject" }]);
    assert.equal(pauses, 0, "an unresolved custom tool never pauses");
    assert.deepEqual(events, [], "no approval card for a fabricated name");
  });

  it("redacts context-bound argument paths from the approval card and the park record", async () => {
    // Bound paths are overwritten from runContext at execution; the card must not show the
    // model's values for them, and the park record (grant key) must match the redacted shape.
    const { session, emit } = makeSession();
    const events: AgentEvent[] = [];
    const gates: any[] = [];

    attachPermissionResponder({
      session,
      run: { emitEvent: (event) => events.push(event) },
      responder: fakeResponder({ kind: "pendingApproval" }),
      piToolSpecsByName: piSpecs([
        [
          "test_run",
          {
            contextBindings: {
              "target.workflow_variant_id": "$ctx.workflow.variant.id",
            },
          },
        ],
      ]),
      onUserApprovalGate: (info) => gates.push(info),
    });
    emit(
      piGateRequest({
        gate: "pi-custom-tool",
        toolName: "test_run",
        toolCallId: "call_1",
        input: {
          target: { workflow_variant_id: "model-sent" },
          inputs: { city: "Berlin" },
        },
      }),
    );
    await flushPromises();

    const payload = (events[0] as any).payload;
    // Bound path gone; its now-empty ancestor object pruned.
    assert.deepEqual(payload.toolCall.rawInput, { inputs: { city: "Berlin" } });
    assert.deepEqual(gates[0].args, { inputs: { city: "Berlin" } });
  });

  it("onPiGateAllowed fires for an allowed custom tool with the redacted args", async () => {
    const { session, emit } = makeSession();
    const allowed: Array<{ toolName: string; args: unknown }> = [];
    const responder = new ApprovalResponder(
      permissionPlan("ask"),
      new ConversationDecisions(new Map()),
    );

    attachPermissionResponder({
      session,
      run: { emitEvent: () => {} },
      responder,
      piToolSpecsByName: piSpecs([
        [
          "author_allow",
          {
            permission: "allow",
            contextBindings: {
              "target.workflow_variant_id": "$ctx.workflow.variant.id",
            },
          },
        ],
      ]),
      onPiGateAllowed: (info) => allowed.push(info),
    });
    emit(
      piGateRequest({
        gate: "pi-custom-tool",
        toolName: "author_allow",
        toolCallId: "c1",
        input: {
          target: { workflow_variant_id: "model-sent" },
          inputs: { city: "Berlin" },
        },
      }),
    );
    await flushPromises();

    assert.deepEqual(allowed, [
      { toolName: "author_allow", args: { inputs: { city: "Berlin" } } },
    ]);
  });

  it("onPiGateAllowed never fires on a deny or for an allowed builtin gate", async () => {
    const { session, emit } = makeSession();
    const allowed: unknown[] = [];
    const responder = new ApprovalResponder(
      permissionPlan("allow_reads"),
      new ConversationDecisions(new Map()),
    );

    attachPermissionResponder({
      session,
      run: { emitEvent: () => {} },
      responder,
      piToolSpecsByName: piSpecs([["author_deny", { permission: "deny" }]]),
      onPiGateAllowed: (info) => allowed.push(info),
    });
    emit(
      piGateRequest({
        gate: "pi-custom-tool",
        toolName: "author_deny",
        toolCallId: "c1",
        input: {},
      }),
    );
    await flushPromises();
    assert.deepEqual(allowed, [], "a denied custom tool grants nothing");

    // A read-only builtin auto-allows under allow_reads, but builtins never reach the relay,
    // so no execution grant is recorded for them.
    emit(
      piGateRequest({
        gate: "pi-builtin",
        toolName: "read",
        toolCallId: "c2",
        input: { path: "a" },
      }),
    );
    await flushPromises();
    assert.deepEqual(allowed, [], "an allowed builtin grants nothing");
  });

  it("a Claude run (no Pi specs) never enters envelope detection, even on a title collision", async () => {
    // attachPermissionResponder is shared by Claude and Pi. On a Claude run (piToolSpecsByName
    // absent), a gate titled literally "agenta-approval" (editing a file with that name, a bash
    // command equal to it) has no envelope and must pause/resolve exactly as on the base path,
    // never auto-reject.
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
      // piToolSpecsByName intentionally absent (a Claude run).
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
