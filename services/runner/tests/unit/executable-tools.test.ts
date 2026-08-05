import assert from "node:assert/strict";
import { describe, it } from "vitest";

import { buildExecutableToolGate } from "../../src/engines/sandbox_agent/executable-tools.ts";
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
  extractApprovalDecisions,
} from "../../src/responder.ts";
import type { ExecutableToolGateRequest } from "../../src/tools/executable-tool-gate.ts";
import type { PermissionPlan } from "../../src/permission-plan.ts";
import {
  declinedByUserText,
  deniedByPolicyText,
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
  const toolCallIndex = withIndex
    ? createToolCallCorrelationIndex()
    : undefined;
  const permissionPlan: PermissionPlan = { default: "allow_reads", rules: [] };
  const responder = new ApprovalResponder(
    permissionPlan,
    new ConversationDecisions(
      history ? extractApprovalDecisions(history) : new Map(),
    ),
  );
  const gate = buildExecutableToolGate({
    responder,
    run: { emitEvent: (event) => events.push(event) },
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
