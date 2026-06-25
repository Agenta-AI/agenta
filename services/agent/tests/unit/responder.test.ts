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
  approvalKey,
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

describe("decisionToReply", () => {
  it("maps allow to ONCE (never always) so an approval grants only this call", () => {
    // SECURITY: `always` would let the harness allow the tool broadly for the rest of the
    // turn without re-gating, re-opening the over-authorization hole. allow -> once, always.
    assert.equal(
      decisionToReply("allow", ["always", "once", "reject"]),
      "once",
      "allow must NOT map to always even when always is offered",
    );
    assert.equal(decisionToReply("allow", ["once", "reject"]), "once");
    assert.equal(
      decisionToReply("allow", []),
      "once",
      "allow falls back to once",
    );
    assert.equal(
      decisionToReply("allow", ["always"]),
      "once",
      "with only always offered, still fall back to once (never broaden)",
    );
  });

  it("maps deny onto reject", () => {
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

describe("approvalKey", () => {
  it("binds name + args, order-independently", () => {
    assert.equal(
      approvalKey("edit", { a: 1, b: 2 }),
      approvalKey("edit", { b: 2, a: 1 }),
      "key order does not change the key",
    );
    assert.notEqual(
      approvalKey("edit", { path: "a" }),
      approvalKey("edit", { path: "b" }),
      "different args -> different key",
    );
    assert.notEqual(
      approvalKey("edit", { path: "a" }),
      approvalKey("bash", { path: "a" }),
      "different name -> different key",
    );
  });

  it("normalizes absent args to {} so a no-arg tool resumes", () => {
    // A no-arg tool has nothing to vary; absent/null/empty all key to the same `name#{}`.
    assert.ok(approvalKey("edit", {}), "empty-object args -> a real key");
    assert.equal(approvalKey("edit", undefined), approvalKey("edit", {}));
    assert.equal(approvalKey("edit", null), approvalKey("edit", {}));
    // But a WITH-args call never collapses to the no-arg key.
    assert.notEqual(
      approvalKey("edit", { path: "a" }),
      approvalKey("edit", {}),
      "args present -> a different key than no-args",
    );
  });

  it("returns no key (fails closed) for no name or non-JSON args", () => {
    assert.equal(
      approvalKey(undefined, { a: 1 }),
      undefined,
      "no name -> no key",
    );
    // Non-JSON args fail closed (no key) rather than throwing or colliding.
    assert.equal(
      approvalKey("edit", 10n as unknown),
      undefined,
      "bigint -> no key",
    );
    assert.equal(approvalKey("edit", new Date()), undefined, "Date -> no key");
    assert.equal(approvalKey("edit", { x: NaN }), undefined, "NaN -> no key");
    assert.equal(approvalKey("edit", new Map()), undefined, "Map -> no key");
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
// tool's id, name, and args (`rawInput`), which is what the responder keys a stored decision
// by. `name` is optional so a test can simulate the live ACP wire (which carries `title`/
// `kind`, not `name`).
function permReq(
  toolCallId?: string,
  name?: string,
  rawInput?: unknown,
): PermissionRequest {
  return {
    id: "perm-1",
    availableReplies: ["once", "always", "reject"],
    raw: { id: "perm-1", toolCall: { toolCallId, name, rawInput } },
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

  it("matches a stored decision by tool name + args when the id was not preserved (cold replay)", async () => {
    // The parked turn approved edit({path:'a.txt'}); a cold replay mints a FRESH tool-call id
    // for the SAME call, so the id no longer matches — but the name + args anchor does.
    const decisions = new Map<string, PermissionDecision>([
      [approvalKey("edit", { path: "a.txt" })!, "allow"],
    ]);
    const responder = new HITLResponder(decisions, "auto", true);
    assert.equal(
      await responder.onPermission(
        permReq("fresh-id", "edit", { path: "a.txt" }),
      ),
      "allow",
    );
  });

  it("SECURITY: approving call A does NOT auto-approve a later call B to the same tool with different args", async () => {
    // The HITL bypass this guards against: a stored `allow` for edit({path:'a.txt'}) must NOT
    // leak to a NEW edit call with DIFFERENT args (e.g. a sensitive path). B must re-prompt.
    const decisions = new Map<string, PermissionDecision>([
      [approvalKey("edit", { path: "a.txt" })!, "allow"],
    ]);
    const responder = new HITLResponder(decisions, "auto", true);
    // Same tool name, different args, brand-new id -> no stored match -> park (re-prompt).
    assert.equal(
      await responder.onPermission(
        permReq("call-b", "edit", { path: "/etc/shadow" }),
      ),
      "park",
      "a different-args call to the same tool must re-prompt, not auto-approve",
    );
    // And argument-order does not let B slip through under A's key.
    const orderDecisions = new Map<string, PermissionDecision>([
      [approvalKey("edit", { a: 1, b: 2 })!, "allow"],
    ]);
    const orderResponder = new HITLResponder(orderDecisions, "auto", true);
    assert.equal(
      await orderResponder.onPermission(
        permReq("call-c", "edit", { b: 2, a: 1 }),
      ),
      "allow",
      "the same args in a different key order is the same call (resumes)",
    );
  });

  it("SECURITY: bare tool NAME is not a key — a stored bare-name entry never auto-approves", async () => {
    // Defense in depth: even if a bare tool name somehow lands in the map, the responder must
    // not honor it (it only consults the id key and the name+args key).
    const decisions = new Map<string, PermissionDecision>([["edit", "allow"]]);
    const responder = new HITLResponder(decisions, "auto", true);
    assert.equal(
      await responder.onPermission(
        permReq("fresh-id", "edit", { path: "a.txt" }),
      ),
      "park",
      "a bare-name entry must not auto-approve a real call",
    );
  });

  it("parks when there is a human surface and no stored decision (NOT deny)", async () => {
    // `basePolicy` is "auto" so this proves the park overrides the policy, not the policy.
    // Park must NOT be `deny`: replying `reject` to Claude clobbers the approval prompt (F-024).
    const responder = new HITLResponder(new Map(), "auto", true);
    assert.equal(await responder.onPermission(permReq("tc-x", "edit")), "park");

    // A deny basePolicy must still PARK (the human surface wins): a human can decide, so the
    // turn ends pending rather than refusing the tool with a clobbering reject.
    const denyBase = new HITLResponder(new Map(), "deny", true);
    assert.equal(await denyBase.onPermission(permReq("tc-w", "edit")), "park");
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
  it("builds the lookup from approval tool_result blocks, keyed by id and by name+args (not bare name)", () => {
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
              input: { cmd: "ls" },
              output: { approved: false },
            },
          ],
        },
      ],
    };

    const decisions = extractApprovalDecisions(request);
    // ONLY the name+args anchor is keyed (recovered from the correlated tool_call block).
    assert.equal(
      decisions.get(approvalKey("edit", { path: "a.txt" })!),
      "allow",
    );
    assert.equal(decisions.get(approvalKey("bash", { cmd: "ls" })!), "deny");
    // The bare tool NAME must NOT be a key (that was the HITL-bypass).
    assert.equal(decisions.has("edit"), false, "no bare-name key");
    assert.equal(decisions.has("bash"), false, "no bare-name key");
    // The historical replayed tool-call id must NOT be a key (cold replay mints fresh ids;
    // a stored historical id could only ever match a fresh one by collision -> args-blind).
    assert.equal(decisions.has("tc-1"), false, "no replayed-id key");
    assert.equal(decisions.has("tc-2"), false, "no replayed-id key");
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
    const request: AgentRunRequest = {
      messages: [{ role: "user", content: "just a single turn" }],
    };
    assert.equal(extractApprovalDecisions(request).size, 0);
  });

  it("end-to-end: an extracted decision resumes via name+args when the approval block names the tool", async () => {
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
              input: { path: "a.txt" },
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
    // Resolves on the name+args anchor (the replayed id is NOT a key).
    assert.equal(
      await responder.onPermission(permReq("tc-1", "edit", { path: "a.txt" })),
      "allow",
    );
  });

  it("end-to-end: a cold replay (FRESH id) resumes the parked call by name+args", async () => {
    // The parked call: edit({path:'a.txt'}) approved. A cold replay rebuilds the session and
    // mints a fresh tool-call id; the id no longer matches, but the name + args anchor does.
    const request: AgentRunRequest = {
      sessionId: "s-3",
      messages: [
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
            // The approval reply may carry only the id + the {approved} envelope; the name +
            // args are recovered from the correlated tool_call block above.
            {
              type: "tool_result",
              toolCallId: "tc-1",
              output: { approved: true },
            },
          ],
        },
      ],
    };
    const responder = new HITLResponder(
      extractApprovalDecisions(request),
      "auto",
      true,
    );
    // Fresh id this turn, but same name + args -> resolves (resume works).
    assert.equal(
      await responder.onPermission(
        permReq("fresh-id", "edit", { path: "a.txt" }),
      ),
      "allow",
      "the parked call resumes under a fresh id via the name+args anchor",
    );
    // SECURITY end-to-end: a different-args call to the same tool re-prompts (no leak).
    assert.equal(
      await responder.onPermission(
        permReq("other-id", "edit", { path: "/etc/passwd" }),
      ),
      "park",
      "a different-args call must NOT inherit the earlier approval",
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
