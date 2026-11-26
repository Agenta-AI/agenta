import assert from "node:assert/strict";
import { describe, it } from "vitest";

import {
  buildExecutableToolGate,
  type BuildExecutableToolGateInput,
} from "../../src/engines/sandbox_agent/executable-tools.ts";
import { createToolCallCorrelationIndex } from "../../src/engines/sandbox_agent/client-tools.ts";
import type {
  AgentEvent,
  AgentRunRequest,
  ResolvedToolSpec,
} from "../../src/protocol.ts";
import {
  ApprovalResponder,
  ApprovedExecutionGrants,
  ConversationDecisions,
} from "../../src/responder.ts";
import { answeredDecisions } from "../utils/answered-decisions.ts";
import type { ExecutableToolGateRequest } from "../../src/tools/executable-tool-gate.ts";
import type { PermissionPlan } from "../../src/permission-plan.ts";
import {
  declinedByUserText,
  deniedByPolicyText,
  targetNotAllowedText,
} from "../../src/tools/denial-text.ts";

const input = { document: "release-notes" };
const request: ExecutableToolGateRequest = {
  id: "permission-1",
  toolCallId: "minted-call-1",
  toolName: "publish",
  input,
  spec: {
    name: "publish",
    kind: "callback",
    callRef: "platform.publish",
    permission: "ask",
  },
};

function approvalHistory(approved: boolean): AgentRunRequest {
  return {
    sessionId: "session-1",
    messages: [
      {
        role: "assistant",
        content: [
          {
            type: "tool_call",
            toolCallId: "prior-call-1",
            toolName: "publish",
            input,
          },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool_result",
            toolCallId: "prior-call-1",
            output: { approved },
          },
        ],
      },
    ],
  };
}

function seam(
  spec: ResolvedToolSpec,
  history?: AgentRunRequest,
  withIndex = false,
  executionGrants?: ApprovedExecutionGrants,
  forceSettled: string[] = [],
) {
  const events: AgentEvent[] = [];
  const pausedToolCalls: string[] = [];
  const recorded: Array<{
    token: string;
    toolName: string | undefined;
    args: unknown;
    kind: string;
    toolCallId: string | undefined;
  }> = [];
  let pauses = 0;
  let nonParkable = 0;
  const toolCallIndex = withIndex
    ? createToolCallCorrelationIndex()
    : undefined;
  const permissionPlan: PermissionPlan = { default: "allow_reads", rules: [] };
  const responder = new ApprovalResponder(
    permissionPlan,
    new ConversationDecisions(
      history ? answeredDecisions(history) : new Map(),
    ),
  );
  const gate = buildExecutableToolGate({
    responder,
    run: {
      emitEvent: (event) => events.push(event),
      wasForceSettled: (id) => forceSettled.includes(id),
    },
    pause: {
      markPausedToolCall: (id) => pausedToolCalls.push(id),
      pause: () => {
        pauses += 1;
      },
    },
    recordPendingInteraction: (token, toolName, args, kind, toolCallId) => {
      recorded.push({ token, toolName, args, kind, toolCallId });
    },
    toolCallIndex,
    onNonParkablePause: () => {
      nonParkable += 1;
    },
    permissionPlan,
    executionGrants,
  });
  return {
    gate,
    request: { ...request, spec },
    events,
    pausedToolCalls,
    recorded,
    toolCallIndex,
    executionGrants,
    pauses: () => pauses,
    nonParkable: () => nonParkable,
  };
}

describe("buildExecutableToolGate", () => {
  it("allows an allow-permission executable tool", async () => {
    const s = seam({ ...request.spec, permission: "allow" });

    assert.deepEqual(await s.gate.onExecutableTool(s.request), {
      kind: "allow",
    });
    assert.deepEqual(s.events, []);
    assert.deepEqual(s.pausedToolCalls, []);
  });

  it("denies a deny-permission executable tool with a policy reason", async () => {
    const s = seam({ ...request.spec, permission: "deny" });

    assert.deepEqual(await s.gate.onExecutableTool(s.request), {
      kind: "deny",
      reason: deniedByPolicyText("publish"),
    });
    assert.deepEqual(s.events, []);
    assert.deepEqual(s.pausedToolCalls, []);
  });

  it("raises no card for an ask tool the pause already closed as not executed", async () => {
    const s = seam(request.spec, undefined, true, undefined, ["acp-call-1"]);
    s.toolCallIndex!.record({
      sessionUpdate: "tool_call",
      toolCallId: "acp-call-1",
      title: "mcp.agenta-tools.publish",
      rawInput: input,
    });

    assert.deepEqual(await s.gate.onExecutableTool(s.request), {
      kind: "pendingApproval",
    });
    assert.deepEqual(s.events, []);
    assert.deepEqual(s.pausedToolCalls, []);
    assert.deepEqual(s.recorded, []);
    assert.equal(s.nonParkable(), 1, "the skipped call ends the turn cold");
  });

  it("parks an undecided ask tool with the user_approval payload and pause callback", async () => {
    const s = seam(request.spec, undefined, true);
    s.toolCallIndex!.record({
      sessionUpdate: "tool_call",
      toolCallId: "acp-call-1",
      title: "mcp.agenta-tools.publish",
      rawInput: input,
    });

    assert.deepEqual(await s.gate.onExecutableTool(s.request), {
      kind: "pendingApproval",
    });
    assert.deepEqual(s.pausedToolCalls, ["acp-call-1"]);
    assert.deepEqual(s.recorded, [
      {
        token: "permission-1",
        toolName: "publish",
        args: input,
        kind: "user_approval",
        toolCallId: "acp-call-1",
      },
    ]);
    assert.equal(s.events.length, 1);
    assert.deepEqual(s.events[0], {
      type: "interaction_request",
      id: "permission-1",
      kind: "user_approval",
      payload: {
        toolCallId: "acp-call-1",
        toolCall: {
          id: "acp-call-1",
          toolCallId: "acp-call-1",
          name: "publish",
          resolvedName: "publish",
          rawInput: input,
          input,
          kind: "execute",
        },
        availableReplies: ["once", "reject"],
      },
    });
    assert.equal(s.pauses(), 0, "the MCP handler owns the pause transition");
    s.gate.onPause?.();
    assert.equal(s.pauses(), 1);
  });

  it("falls back to the minted tool-call id when the correlation index has no entry", async () => {
    const s = seam(request.spec, undefined, true);

    assert.deepEqual(await s.gate.onExecutableTool(s.request), {
      kind: "pendingApproval",
    });
    assert.deepEqual(s.pausedToolCalls, ["minted-call-1"]);
    assert.equal(s.recorded[0]?.toolCallId, "minted-call-1");
  });

  it.each([
    { approved: true, expected: { kind: "allow" } },
    {
      approved: false,
      expected: {
        kind: "deny",
        // A REPLAYED HUMAN DECLINE, not a policy refusal. The tool's permission is `ask`, and
        // `decide` reads the stored answer, so telling the model this was policy would send it
        // back to retry a decision the user already made.
        reason: declinedByUserText("publish"),
      },
    },
  ])(
    "cold replay resolves a stored approved=$approved decision",
    async ({ approved, expected }) => {
      const s = seam(request.spec, approvalHistory(approved));

      assert.deepEqual(await s.gate.onExecutableTool(s.request), expected);
      assert.deepEqual(s.events, []);
      assert.deepEqual(s.pausedToolCalls, []);
    },
  );
});

/**
 * A harness that runs its own permission gates (Claude always; Codex since the full-access
 * preset was patched to `on-request`) decides a call BEFORE issuing it, then the same call
 * arrives here at the loopback `agenta-tools` MCP seam. Without the grant handshake the human
 * would answer twice for one tool call.
 */
describe("buildExecutableToolGate with a harness-gate execution grant", () => {
  it("passes a call the harness gate already approved straight through", async () => {
    const grants = new ApprovedExecutionGrants();
    grants.grant("publish", input);
    const s = seam(request.spec, undefined, false, grants);

    assert.deepEqual(await s.gate.onExecutableTool(s.request), {
      kind: "allow",
    });
    assert.deepEqual(s.events, [], "no second approval card");
    assert.deepEqual(s.pausedToolCalls, []);
  });

  it("spends one grant per call, so a repeat call parks again", async () => {
    const grants = new ApprovedExecutionGrants();
    grants.grant("publish", input);
    const s = seam(request.spec, undefined, false, grants);

    assert.deepEqual(await s.gate.onExecutableTool(s.request), {
      kind: "allow",
    });
    assert.deepEqual(await s.gate.onExecutableTool(s.request), {
      kind: "pendingApproval",
    });
  });

  it("matches Codex's MCP argument wrapper against the seam's bare arguments", async () => {
    // codex-acp reports an MCP tool call's rawInput as {server, tool, arguments}; the seam sees
    // the inner arguments. Both sides normalize to the same key, so the grant still matches.
    const grants = new ApprovedExecutionGrants();
    grants.grant("publish", {
      server: "agenta-tools",
      tool: "publish",
      arguments: input,
    });
    const s = seam(request.spec, undefined, false, grants);

    assert.deepEqual(await s.gate.onExecutableTool(s.request), {
      kind: "allow",
    });
  });

  it("never lets a grant override a deny, and parks with no grant (fail closed)", async () => {
    const grants = new ApprovedExecutionGrants();
    grants.grant("publish", input);
    const denied = seam(
      { ...request.spec, permission: "deny" },
      undefined,
      false,
      grants,
    );
    assert.deepEqual(await denied.gate.onExecutableTool(denied.request), {
      kind: "deny",
      reason: deniedByPolicyText("publish"),
    });

    const ungranted = seam(
      request.spec,
      undefined,
      false,
      new ApprovedExecutionGrants(),
    );
    assert.deepEqual(await ungranted.gate.onExecutableTool(ungranted.request), {
      kind: "pendingApproval",
    });
  });

  it("does not spend a grant on a tool the policy already allows", async () => {
    const grants = new ApprovedExecutionGrants();
    grants.grant("publish", input);
    const s = seam(
      { ...request.spec, permission: "allow" },
      undefined,
      false,
      grants,
    );

    assert.deepEqual(await s.gate.onExecutableTool(s.request), {
      kind: "allow",
    });
    assert.equal(
      grants.consume("publish", input),
      true,
      "the grant is untouched because the policy allow decided the call",
    );
  });
});

describe("buildExecutableToolGate with a server answer at the gate", () => {
  function serverSeam(
    permission: "allow" | "ask" | "deny",
    executionGrants?: ApprovedExecutionGrants,
    opts: {
      recordCard?: boolean;
      basis?: string;
      resolveApprovedContent?: BuildExecutableToolGateInput["resolveApprovedContent"];
    } = {},
  ) {
    const events: AgentEvent[] = [];
    let pauses = 0;
    let asked = 0;
    const permissionPlan: PermissionPlan = {
      default: "allow_reads",
      rules: [],
    };
    const responder = new ApprovalResponder(
      permissionPlan,
      new ConversationDecisions(new Map()),
      () => {},
      () => {
        asked += 1;
        return Promise.resolve(
          permission === "ask"
            ? { permission }
            : { permission, basis: opts.basis ?? "configured_permission" },
        );
      },
    );
    const gate = buildExecutableToolGate({
      responder,
      run: {
        emitEvent: (event) => events.push(event),
        wasForceSettled: () => false,
      },
      pause: {
        markPausedToolCall: () => {},
        pause: () => {
          pauses += 1;
        },
      },
      recordPendingInteraction: () => {
        if (!opts.recordCard) throw new Error("no card may be recorded");
      },
      permissionPlan,
      executionGrants,
      resolveApprovedContent: opts.resolveApprovedContent,
    });
    return { gate, events, pauses: () => pauses, asked: () => asked };
  }

  it("runs the call with no card on allow", async () => {
    const { gate, events, pauses } = serverSeam("allow");
    assert.deepEqual(await gate.onExecutableTool(request), { kind: "allow" });
    assert.equal(pauses(), 0);
    assert.deepEqual(events, [], "a configured allow leaves no mark");
  });

  it("marks a call that the person's approval choice allowed", async () => {
    const { gate, events } = serverSeam("allow", undefined, {
      basis: "approval_choice",
    });
    assert.deepEqual(await gate.onExecutableTool(request), { kind: "allow" });
    assert.deepEqual(events, [
      {
        type: "data",
        name: "auto-approved",
        data: { toolCallId: request.toolCallId, toolName: "publish" },
      },
    ]);
  });

  it("mints the approved content before an allowed call runs, as a card does", async () => {
    const resolved: unknown[] = [];
    const { gate, events } = serverSeam("allow", undefined, {
      basis: "approval_choice",
      resolveApprovedContent: async (call) => {
        resolved.push(call);
        return { ok: true };
      },
    });
    assert.deepEqual(await gate.onExecutableTool(request), { kind: "allow" });
    assert.deepEqual(resolved, [
      { toolName: "publish", toolCallId: request.toolCallId, args: input },
    ]);
    assert.equal(events.length, 1);
  });

  it("refuses an allowed call whose approved content does not resolve, with no mark", async () => {
    const { gate, events } = serverSeam("allow", undefined, {
      basis: "approval_choice",
      resolveApprovedContent: async () => ({ ok: false, reason: "no such file" }),
    });
    assert.deepEqual(await gate.onExecutableTool(request), {
      kind: "deny",
      reason: "no such file",
    });
    assert.deepEqual(events, []);
  });

  it("spends the grant that the harness gate left and does not ask the server again", async () => {
    // The harness gate asked the server and left a grant; the seam's second answer would deny.
    const grants = new ApprovedExecutionGrants();
    grants.grant("publish", input);
    const { gate, asked } = serverSeam("deny", grants);
    assert.deepEqual(await gate.onExecutableTool(request), { kind: "allow" });
    assert.equal(asked(), 0);
    assert.equal(
      grants.consume("publish", input),
      false,
      "no grant is left to answer a later call with the same arguments",
    );
  });

  it("shows the card when there is no grant and the server answers ask", async () => {
    const { gate, pauses } = serverSeam("ask", new ApprovedExecutionGrants(), {
      recordCard: true,
    });
    assert.deepEqual(await gate.onExecutableTool(request), {
      kind: "pendingApproval",
    });
    assert.equal(pauses(), 0, "the seam parks; the run pauses later");
  });

  it("words a server deny as a refused target, not a tool-wide refusal or a decline", async () => {
    const { gate, pauses } = serverSeam("deny");
    assert.deepEqual(await gate.onExecutableTool(request), {
      kind: "deny",
      reason: targetNotAllowedText("publish"),
    });
    assert.equal(pauses(), 0);
  });
});

describe("buildExecutableToolGate when a sibling call pauses the turn during the change preview", () => {
  // The real runner closes every open call that is not marked paused when the turn pauses
  // (`settleOpenToolCalls`); this fake does the same, and resolves the pause signal.
  function racingSeam() {
    const events: AgentEvent[] = [];
    const paused = new Set<string>();
    const settled = new Set<string>();
    let nonParkable = 0;
    let resolvePreview: (value: Record<string, unknown>) => void = () => {};
    let resolvePauseSignal: () => void = () => {};
    const pauseSignal = new Promise<void>((resolve) => {
      resolvePauseSignal = resolve;
    });
    const permissionPlan: PermissionPlan = {
      default: "allow_reads",
      rules: [],
    };
    const gate = buildExecutableToolGate({
      responder: new ApprovalResponder(
        permissionPlan,
        new ConversationDecisions(new Map()),
      ),
      run: {
        emitEvent: (event) => events.push(event),
        wasForceSettled: (id) => settled.has(id),
      },
      pause: {
        markPausedToolCall: (id) => paused.add(id),
        pause: () => {},
      },
      recordPendingInteraction: () => {},
      onNonParkablePause: () => {
        nonParkable += 1;
      },
      permissionPlan,
      resolveChangePreview: () =>
        new Promise((resolve) => {
          resolvePreview = resolve;
        }),
      pauseSignal,
    });
    const siblingPausesTurn = () => {
      if (!paused.has(request.toolCallId)) settled.add(request.toolCallId);
      resolvePauseSignal();
    };
    return {
      gate,
      events,
      siblingPausesTurn,
      resolvePreview: (value: Record<string, unknown>) => resolvePreview(value),
      nonParkable: () => nonParkable,
    };
  }

  it("still raises the approval card", async () => {
    const s = racingSeam();
    const verdict = s.gate.onExecutableTool(request);
    await new Promise((resolve) => setImmediate(resolve));
    s.siblingPausesTurn();
    s.resolvePreview({ changes: [] });

    assert.deepEqual(await verdict, { kind: "pendingApproval" });
    assert.equal(s.events.length, 1, "the approval card is emitted");
    assert.equal(s.nonParkable(), 0, "the turn can still park");
  });

  it("stops waiting for the preview once the turn pauses", async () => {
    const s = racingSeam();
    const verdict = s.gate.onExecutableTool(request);
    await new Promise((resolve) => setImmediate(resolve));
    s.siblingPausesTurn();

    const timedOut = Symbol("timed out");
    const outcome = await Promise.race([
      verdict,
      new Promise((resolve) => setTimeout(() => resolve(timedOut), 1_000)),
    ]);
    assert.deepEqual(outcome, { kind: "pendingApproval" });
    assert.equal(s.events.length, 1);
    const payload = (s.events[0] as { payload: Record<string, unknown> })
      .payload;
    assert.equal(
      "preview" in payload,
      false,
      "the card opens without a preview",
    );
  });
});
