/**
 * Unit tests for the interaction responder seam and the otel `emitEvent` hook.
 *
 * Run: pnpm test (or: pnpm exec vitest run tests/unit/responder.test.ts)
 */
import { afterEach, describe, it } from "vitest";
import assert from "node:assert/strict";

import { createSandboxAgentOtel } from "../../src/tracing/otel.ts";
import type { AgentEvent, AgentRunRequest } from "../../src/protocol.ts";
import type { GateDescriptor, PermissionPlan } from "../../src/permission-plan.ts";
import {
  ApprovalResponder,
  ConversationDecisions,
  approvedCallKey,
  decisionToReply,
  extractApprovalDecisions,
  policyFromRequest,
  type PermissionDecision,
} from "../../src/responder.ts";

afterEach(() => {
  delete process.env.SANDBOX_AGENT_DENY_PERMISSIONS;
});

function plan(defaultMode: PermissionPlan["default"]): PermissionPlan {
  return { default: defaultMode, rules: [] };
}

function gate(overrides: Partial<GateDescriptor> = {}): GateDescriptor {
  return {
    executor: "harness",
    toolName: "edit",
    args: { path: "a.txt" },
    ...overrides,
  };
}

async function permissionVerdict(
  responder: ApprovalResponder,
  descriptor: GateDescriptor,
) {
  return responder.onPermission({
    id: "perm-1",
    availableReplies: ["once", "reject"],
    gate: descriptor,
  });
}

describe("policyFromRequest", () => {
  it("honors the arg and the env override", () => {
    delete process.env.SANDBOX_AGENT_DENY_PERMISSIONS;
    assert.equal(policyFromRequest(undefined), "auto");
    assert.equal(policyFromRequest("auto"), "auto");
    assert.equal(policyFromRequest("deny"), "deny");

    process.env.SANDBOX_AGENT_DENY_PERMISSIONS = "true";
    assert.equal(policyFromRequest(undefined), "deny", "env forces deny");
    assert.equal(policyFromRequest("auto"), "deny", "env overrides auto");
    delete process.env.SANDBOX_AGENT_DENY_PERMISSIONS;
  });
});

describe("decisionToReply", () => {
  it("maps allow to ONCE (never always) so an approval grants only this call", () => {
    assert.equal(
      decisionToReply("allow", ["always", "once", "reject"]),
      "once",
      "allow must NOT map to always even when always is offered",
    );
    assert.equal(decisionToReply("allow", ["once", "reject"]), "once");
    assert.equal(decisionToReply("allow", []), "once");
    assert.equal(decisionToReply("allow", ["always"]), "once");
  });

  it("maps deny onto reject", () => {
    assert.equal(
      decisionToReply("deny", ["always", "once", "reject"]),
      "reject",
    );
    assert.equal(decisionToReply("deny", []), "reject");
  });
});

describe("approvedCallKey", () => {
  it("binds name + args, order-independently", () => {
    assert.equal(
      approvedCallKey("edit", { a: 1, b: 2 }),
      approvedCallKey("edit", { b: 2, a: 1 }),
    );
    assert.notEqual(
      approvedCallKey("edit", { path: "a" }),
      approvedCallKey("edit", { path: "b" }),
    );
    assert.notEqual(
      approvedCallKey("edit", { path: "a" }),
      approvedCallKey("bash", { path: "a" }),
    );
  });

  it("normalizes absent args to {} so a no-arg tool resumes", () => {
    assert.ok(approvedCallKey("edit", {}));
    assert.equal(approvedCallKey("edit", undefined), approvedCallKey("edit", {}));
    assert.equal(approvedCallKey("edit", null), approvedCallKey("edit", {}));
    assert.notEqual(
      approvedCallKey("edit", { path: "a" }),
      approvedCallKey("edit", {}),
    );
  });

  it("returns no key for no name or non-JSON args", () => {
    assert.equal(approvedCallKey(undefined, { a: 1 }), undefined);
    assert.equal(approvedCallKey("edit", 10n as unknown), undefined);
    assert.equal(approvedCallKey("edit", new Date()), undefined);
    assert.equal(approvedCallKey("edit", { x: NaN }), undefined);
    assert.equal(approvedCallKey("edit", new Map()), undefined);
  });
});

describe("ApprovalResponder", () => {
  it("allows and denies from the effective permission before stored decisions", async () => {
    const key = approvedCallKey("edit", { path: "a.txt" })!;
    const stored = new Map<string, unknown>([[key, "allow"]]);
    const deny = new ApprovalResponder(plan("deny"), new ConversationDecisions(stored));

    assert.deepEqual(await permissionVerdict(deny, gate()), { kind: "deny" });
    assert.equal(stored.has(key), true, "effective deny does not consume stale allow");

    const allow = new ApprovalResponder(
      plan("allow"),
      new ConversationDecisions(new Map([[key, "deny"]])),
    );
    assert.deepEqual(await permissionVerdict(allow, gate()), { kind: "allow" });
  });

  it("under ask, consumes a stored allow only once", async () => {
    const key = approvedCallKey("edit", { path: "a.txt" })!;
    const responder = new ApprovalResponder(
      plan("ask"),
      new ConversationDecisions(new Map([[key, "allow"]])),
    );

    assert.deepEqual(await permissionVerdict(responder, gate()), { kind: "allow" });
    assert.deepEqual(await permissionVerdict(responder, gate()), {
      kind: "pendingApproval",
    });
  });

  it("under ask, consumes a stored deny and otherwise pauses", async () => {
    const key = approvedCallKey("edit", { path: "a.txt" })!;
    const responder = new ApprovalResponder(
      plan("ask"),
      new ConversationDecisions(new Map([[key, "deny"]])),
    );

    assert.deepEqual(await permissionVerdict(responder, gate()), { kind: "deny" });
    assert.deepEqual(await permissionVerdict(responder, gate()), {
      kind: "pendingApproval",
    });

    const noStored = new ApprovalResponder(plan("ask"), new ConversationDecisions(new Map()));
    assert.deepEqual(await permissionVerdict(noStored, gate()), {
      kind: "pendingApproval",
    });
  });

  it("client tools default to browser-forward pause and explicit deny refuses", async () => {
    const responder = new ApprovalResponder(
      plan("ask"),
      new ConversationDecisions(new Map()),
    );
    const client = gate({ executor: "client", toolName: "request_connection" });

    assert.deepEqual(
      await responder.onClientTool({ id: "tool-1", gate: client }),
      { kind: "pendingApproval" },
    );
    assert.deepEqual(
      await responder.onClientTool({
        id: "tool-1",
        gate: { ...client, specPermission: "deny" },
      }),
      { kind: "deny" },
    );
  });

  it("client tools fulfill from stored output before the permission ladder", async () => {
    const key = approvedCallKey("request_connection", { integration: "slack" })!;
    const output = { connected: true };
    const responder = new ApprovalResponder(
      plan("deny"),
      new ConversationDecisions(new Map([[key, output]])),
    );
    const client = gate({
      executor: "client",
      toolName: "request_connection",
      args: { integration: "slack" },
    });

    assert.deepEqual(await responder.onClientTool({ id: "tool-1", gate: client }), {
      kind: "fulfilled",
      output,
    });
    assert.deepEqual(await responder.onClientTool({ id: "tool-1", gate: client }), {
      kind: "deny",
    });
  });

  it("client explicit ask consumes stored deny; stored allow still forwards to the browser", async () => {
    const denyKey = approvedCallKey("request_connection", { integration: "slack" })!;
    const denyResponder = new ApprovalResponder(
      plan("allow"),
      new ConversationDecisions(new Map([[denyKey, "deny"]])),
    );
    const client = gate({
      executor: "client",
      toolName: "request_connection",
      specPermission: "ask",
      args: { integration: "slack" },
    });
    assert.deepEqual(await denyResponder.onClientTool({ id: "tool-1", gate: client }), {
      kind: "deny",
    });

    const allowResponder = new ApprovalResponder(
      plan("allow"),
      new ConversationDecisions(new Map([[denyKey, "allow"]])),
    );
    assert.deepEqual(await allowResponder.onClientTool({ id: "tool-1", gate: client }), {
      kind: "pendingApproval",
    });
  });
});

describe("extractApprovalDecisions", () => {
  it("builds the lookup from approval tool_result blocks by name+args", () => {
    const request: AgentRunRequest = {
      sessionId: "s-1",
      messages: [
        { role: "user", content: "do the thing" },
        {
          role: "assistant",
          content: [
            {
              type: "tool_call",
              toolCallId: "tc-1",
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
              toolCallId: "tc-1",
              toolName: "edit",
              output: { approved: true },
            },
            {
              type: "tool_result",
              toolCallId: "tc-2",
              toolName: "bash",
              input: { cmd: "ls" },
              output: { approved: false },
            },
          ],
        },
      ],
    };

    const decisions = extractApprovalDecisions(request);
    assert.equal(decisions.get(approvedCallKey("edit", { path: "a.txt" })!), "allow");
    assert.equal(decisions.get(approvedCallKey("bash", { cmd: "ls" })!), "deny");
    assert.equal(decisions.has("edit"), false);
    assert.equal(decisions.has("tc-1"), false);
  });

  it("stores correlated client-tool outputs under the same call key", () => {
    const request: AgentRunRequest = {
      messages: [
        {
          role: "assistant",
          content: [
            {
              type: "tool_call",
              toolCallId: "tc-client",
              toolName: "request_connection",
              input: { integration: "slack" },
            },
          ],
        },
        {
          role: "tool",
          content: [
            {
              type: "tool_result",
              toolCallId: "tc-client",
              output: { connected: true },
            },
          ],
        },
      ],
    };

    const decisions = extractApprovalDecisions(request);
    assert.deepEqual(
      decisions.get(approvedCallKey("request_connection", { integration: "slack" })!),
      { connected: true },
    );
  });

  it("ignores ordinary tool results that cannot be bound to a call shape", () => {
    const request: AgentRunRequest = {
      messages: [
        {
          role: "tool",
          content: [
            { type: "tool_result", toolCallId: "tc-9", output: "the weather is 24C" },
            { type: "tool_result", toolCallId: "tc-10", output: { temp: 24 } },
            { type: "text", text: "hello" },
          ],
        },
      ],
    };

    assert.equal(extractApprovalDecisions(request).size, 0);
  });

  it("returns an empty lookup when there are no structured messages", () => {
    const request: AgentRunRequest = {
      messages: [{ role: "user", content: "just a single turn" }],
    };
    assert.equal(extractApprovalDecisions(request).size, 0);
  });
});

describe("emitEvent", () => {
  it("streaming path: flushes to the live sink and the batch log", () => {
    const emitted: AgentEvent[] = [];
    const run = createSandboxAgentOtel({
      harness: "claude",
      model: "anthropic/x",
      emit: (e) => emitted.push(e),
    });
    run.start({ prompt: "hi" });
    const interaction: AgentEvent = {
      type: "interaction_request",
      id: "p1",
      kind: "user_approval",
      payload: { availableReplies: ["once", "reject"] },
    };
    run.emitEvent(interaction);

    const live = emitted.find((e) => e.type === "interaction_request");
    assert.ok(live);
    assert.equal((live as any).id, "p1");
    assert.ok(run.events().some((e) => e.type === "interaction_request"));
  });

  it("one-shot path: records in the batch log only", () => {
    const run = createSandboxAgentOtel({
      harness: "claude",
      model: "anthropic/x",
    });
    run.start({ prompt: "hi" });
    run.emitEvent({ type: "data", name: "weather", data: { temp: 24 } });
    const ev = run.events().find((e) => e.type === "data");
    assert.ok(ev);
    assert.equal((ev as any).name, "weather");
  });
});
