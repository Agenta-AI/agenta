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
  ConversationDecisions,
  extractApprovalDecisions,
} from "../../src/responder.ts";
import type { ExecutableToolGateRequest } from "../../src/tools/executable-tool-gate.ts";

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
) {
  const events: AgentEvent[] = [];
  const pausedToolCalls: string[] = [];
  const recorded: Array<{
    token: string;
    toolName: string | undefined;
    args: unknown;
    kind: string;
  }> = [];
  let pauses = 0;
  const toolCallIndex = withIndex
    ? createToolCallCorrelationIndex()
    : undefined;
  const responder = new ApprovalResponder(
    { default: "allow_reads", rules: [] },
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
    recordPendingInteraction: (token, toolName, args, kind) => {
      recorded.push({ token, toolName, args, kind });
    },
    toolCallIndex,
  });
  return {
    gate,
    request: { ...request, spec },
    events,
    pausedToolCalls,
    recorded,
    toolCallIndex,
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
      reason: "Tool 'publish' was denied by policy.",
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

  it.each([
    { approved: true, expected: { kind: "allow" } },
    {
      approved: false,
      expected: {
        kind: "deny",
        reason: "Tool 'publish' was denied by policy.",
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
