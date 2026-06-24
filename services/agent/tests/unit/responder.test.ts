/**
 * Unit tests for the interaction responder seam and the otel `emitEvent` hook.
 *
 * Covers the behavior parity of the responder (it replaces the old inline auto-approve in
 * sandbox_agent.ts) and that an out-of-stream event (an `interaction_request`) routed through
 * `emitEvent` lands in both the live sink and the batch `events()` log. No harness, no
 * network.
 *
 * Run: pnpm test (or: pnpm exec vitest run tests/unit/responder.test.ts)
 */
import { afterEach, describe, it } from "vitest";
import assert from "node:assert/strict";

import { createSandboxAgentOtel } from "../../src/tracing/otel.ts";
import type { AgentEvent, AgentRunRequest } from "../../src/protocol.ts";
import {
  HITLResponder,
  PolicyResponder,
  decisionToReply,
  extractApprovalDecisions,
  policyFromRequest,
  type PermissionDecision,
  type PermissionRequest,
} from "../../src/responder.ts";

// Defensive cleanup: policyFromRequest reads this env var; never let it leak past a test
// (e.g. if an assertion throws mid-test, before the inline delete runs).
afterEach(() => {
  delete process.env.SANDBOX_AGENT_DENY_PERMISSIONS;
});

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

describe("decisionToReply (parity with the old inline mapping)", () => {
  it("maps allow/deny onto the available replies", () => {
    assert.equal(
      decisionToReply("allow", ["always", "once", "reject"]),
      "always",
    );
    assert.equal(decisionToReply("allow", ["once", "reject"]), "once");
    assert.equal(
      decisionToReply("allow", []),
      "once",
      "allow falls back to once",
    );
    assert.equal(
      decisionToReply("deny", ["always", "once", "reject"]),
      "reject",
    );
    assert.equal(
      decisionToReply("deny", []),
      "reject",
      "deny falls back to reject",
    );
  });
});

describe("PolicyResponder", () => {
  it("auto allows and deny denies", async () => {
    const auto = new PolicyResponder("auto");
    const deny = new PolicyResponder("deny");
    const req = { id: "p1", availableReplies: ["once", "reject"] };
    assert.equal(await auto.onPermission(req), "allow");
    assert.equal(await deny.onPermission(req), "deny");
  });
});

// A permission request as the harness adapter shapes it: `raw.toolCall` carries the gated
// tool's id + name, which is what the responder keys a stored decision by.
function permReq(toolCallId?: string, name?: string): PermissionRequest {
  return {
    id: "perm-1",
    availableReplies: ["once", "always", "reject"],
    raw: { id: "perm-1", toolCall: { toolCallId, name } },
  };
}

describe("HITLResponder", () => {
  it("applies a stored decision (resume path) by tool-call id", async () => {
    const decisions = new Map<string, PermissionDecision>([["tc-1", "allow"]]);
    const allow = new HITLResponder(decisions, "auto", true);
    assert.equal(await allow.onPermission(permReq("tc-1", "edit")), "allow");

    const denied = new Map<string, PermissionDecision>([["tc-2", "deny"]]);
    const deny = new HITLResponder(denied, "auto", true);
    assert.equal(await deny.onPermission(permReq("tc-2", "edit")), "deny");
  });

  it("matches a stored decision by tool name when the id was not preserved", async () => {
    const decisions = new Map<string, PermissionDecision>([["edit", "allow"]]);
    const responder = new HITLResponder(decisions, "auto", true);
    // Fresh tool-call id this turn, but the name still matches the recorded decision.
    assert.equal(
      await responder.onPermission(permReq("fresh-id", "edit")),
      "allow",
    );
  });

  it("parks (deny) when there is a human surface and no stored decision", async () => {
    // `basePolicy` is "auto" so this proves the park overrides the policy, not the policy.
    const responder = new HITLResponder(new Map(), "auto", true);
    assert.equal(await responder.onPermission(permReq("tc-x", "edit")), "deny");
  });

  it("headless: no decision + no human surface falls back to basePolicy (PolicyResponder parity)", async () => {
    const auto = new HITLResponder(new Map(), "auto", false);
    const deny = new HITLResponder(new Map(), "deny", false);
    assert.equal(await auto.onPermission(permReq("tc-y", "edit")), "allow");
    assert.equal(await deny.onPermission(permReq("tc-z", "edit")), "deny");

    // Byte-for-byte the same result the old headless responder produced.
    const policyAuto = new PolicyResponder("auto");
    const policyDeny = new PolicyResponder("deny");
    assert.equal(
      await auto.onPermission(permReq("tc-y", "edit")),
      await policyAuto.onPermission(permReq("tc-y", "edit")),
    );
    assert.equal(
      await deny.onPermission(permReq("tc-z", "edit")),
      await policyDeny.onPermission(permReq("tc-z", "edit")),
    );
  });
});

describe("extractApprovalDecisions", () => {
  it("builds the lookup from approval tool_result blocks, keyed by id and name", () => {
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
              input: {},
            },
          ],
        },
        {
          // The cross-turn approval reply the Vercel adapter produced.
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
              output: { approved: false },
            },
          ],
        },
      ],
    };

    const decisions = extractApprovalDecisions(request);
    assert.equal(decisions.get("tc-1"), "allow");
    assert.equal(decisions.get("edit"), "allow");
    assert.equal(decisions.get("tc-2"), "deny");
    assert.equal(decisions.get("bash"), "deny");
  });

  it("ignores ordinary tool results that are not approval envelopes", () => {
    const request: AgentRunRequest = {
      messages: [
        {
          role: "tool",
          content: [
            // A real tool output, not an `{approved}` envelope.
            {
              type: "tool_result",
              toolCallId: "tc-9",
              output: "the weather is 24C",
            },
            // Structured output that merely lacks `approved`.
            { type: "tool_result", toolCallId: "tc-10", output: { temp: 24 } },
            // Text block: not a decision.
            { type: "text", text: "hello" },
          ],
        },
      ],
    };

    const decisions = extractApprovalDecisions(request);
    assert.equal(decisions.size, 0);
  });

  it("returns an empty lookup when there are no structured messages (headless /invoke)", () => {
    const request: AgentRunRequest = { prompt: "just a single turn" };
    assert.equal(extractApprovalDecisions(request).size, 0);
  });

  it("end-to-end: an extracted decision resumes a parked permission", async () => {
    const request: AgentRunRequest = {
      sessionId: "s-2",
      messages: [
        {
          role: "tool",
          content: [
            {
              type: "tool_result",
              toolCallId: "tc-1",
              toolName: "edit",
              output: { approved: true },
            },
          ],
        },
      ],
    };
    const responder = new HITLResponder(
      extractApprovalDecisions(request),
      "auto",
      true, // human surface present, but the stored decision wins over the park
    );
    assert.equal(
      await responder.onPermission(permReq("tc-1", "edit")),
      "allow",
    );
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
      kind: "permission",
      payload: { availableReplies: ["once", "reject"] },
    };
    run.emitEvent(interaction);

    const live = emitted.find((e) => e.type === "interaction_request");
    assert.ok(live, "interaction_request flushed to the live sink");
    assert.equal((live as any).id, "p1");
    assert.ok(
      run.events().some((e) => e.type === "interaction_request"),
      "interaction_request also recorded in the batch log",
    );
  });

  it("one-shot path: records in the batch log only", () => {
    const run = createSandboxAgentOtel({
      harness: "claude",
      model: "anthropic/x",
    });
    run.start({ prompt: "hi" });
    run.emitEvent({ type: "data", name: "weather", data: { temp: 24 } });
    const ev = run.events().find((e) => e.type === "data");
    assert.ok(ev, "data event recorded with no live sink");
    assert.equal((ev as any).name, "weather");
  });
});
