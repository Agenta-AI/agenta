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
  parkedCallKey,
  decisionToReply,
  extractApprovalDecisions,
  nonConvergingToolNames,
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

describe("parkedCallKey", () => {
  it("binds name + args, order-independently", () => {
    assert.equal(
      parkedCallKey("edit", { a: 1, b: 2 }),
      parkedCallKey("edit", { b: 2, a: 1 }),
      "key order does not change the key",
    );
    assert.notEqual(
      parkedCallKey("edit", { path: "a" }),
      parkedCallKey("edit", { path: "b" }),
      "different args -> different key",
    );
    assert.notEqual(
      parkedCallKey("edit", { path: "a" }),
      parkedCallKey("bash", { path: "a" }),
      "different name -> different key",
    );
  });

  it("normalizes absent args to {} so a no-arg tool resumes", () => {
    // A no-arg tool has nothing to vary; absent/null/empty all key to the same `name#{}`.
    assert.ok(parkedCallKey("edit", {}), "empty-object args -> a real key");
    assert.equal(parkedCallKey("edit", undefined), parkedCallKey("edit", {}));
    assert.equal(parkedCallKey("edit", null), parkedCallKey("edit", {}));
    // But a WITH-args call never collapses to the no-arg key.
    assert.notEqual(
      parkedCallKey("edit", { path: "a" }),
      parkedCallKey("edit", {}),
      "args present -> a different key than no-args",
    );
  });

  it("returns no key (fails closed) for no name or non-JSON args", () => {
    assert.equal(
      parkedCallKey(undefined, { a: 1 }),
      undefined,
      "no name -> no key",
    );
    // Non-JSON args fail closed (no key) rather than throwing or colliding.
    assert.equal(
      parkedCallKey("edit", 10n as unknown),
      undefined,
      "bigint -> no key",
    );
    assert.equal(parkedCallKey("edit", new Date()), undefined, "Date -> no key");
    assert.equal(parkedCallKey("edit", { x: NaN }), undefined, "NaN -> no key");
    assert.equal(parkedCallKey("edit", new Map()), undefined, "Map -> no key");
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
      [parkedCallKey("edit", { path: "a.txt" })!, "allow"],
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
      [parkedCallKey("edit", { path: "a.txt" })!, "allow"],
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
      [parkedCallKey("edit", { a: 1, b: 2 })!, "allow"],
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
      decisions.get(parkedCallKey("edit", { path: "a.txt" })!),
      "allow",
    );
    assert.equal(decisions.get(parkedCallKey("bash", { cmd: "ls" })!), "deny");
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
      kind: "user_approval",
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

// A permission request whose ACP tool call carries a resolved spec (with a STABLE canonical
// name) plus drift-prone display fields (title/kind). The live wire for a Claude tool has no
// `name`, so the key must anchor on `spec.name`, not the title/kind that varies across turns.
function permReqWithSpec(
  toolCallId: string,
  specName: string,
  displayTitle: string,
  rawInput?: unknown,
): PermissionRequest {
  return {
    id: "perm-1",
    availableReplies: ["once", "always", "reject"],
    raw: {
      id: "perm-1",
      toolCall: {
        toolCallId,
        title: displayTitle,
        kind: "execute",
        spec: { name: specName },
        rawInput,
      },
    },
  };
}

// The LIVE production shape (from runner logs): a Claude-over-ACP gate with NO spec and a
// permission-frame `title` that is the specific invocation ("cat ~/...") — which DIFFERS from the
// `session/update` tool_call title the transcript stored ("Terminal"). The engine recovers the
// recorded tool_call name and stamps it as `resolvedName`; the key must anchor on THAT.
function permReqResolved(
  toolCallId: string,
  resolvedName: string,
  driftingTitle: string,
  rawInput?: unknown,
): PermissionRequest {
  return {
    id: "perm-1",
    availableReplies: ["once", "always", "reject"],
    raw: {
      id: "perm-1",
      toolCall: { toolCallId, resolvedName, title: driftingTitle, kind: "execute", rawInput },
    },
  };
}

describe("HITLResponder — recorded-name anchor (the live ACP title-drift loop)", () => {
  it("resumes: stored key uses the tool_call name (Terminal) while the permission title drifts (cat ...)", async () => {
    // Exactly the logged failure: stored `Terminal#{command,description}` -> allow, re-raised gate
    // whose ACP permission title is the full command. Without `resolvedName` the live key would be
    // `cat ...#args` and never match -> re-park loop. With it, the live key is `Terminal#args`.
    const args = { command: "cat ~/.claude/settings.json", description: "Read global settings" };
    const decisions = new Map<string, PermissionDecision>([
      [parkedCallKey("Terminal", args)!, "allow"],
    ]);
    const responder = new HITLResponder(decisions, "auto", true);
    assert.equal(
      await responder.onPermission(
        permReqResolved("fresh-id", "Terminal", "cat ~/.claude/settings.json", args),
      ),
      "allow",
      "the recorded tool_call name anchors the resume despite the drifting permission title",
    );
  });

  it("the loop-breaker also matches on the recorded name (looping set is keyed the same way)", async () => {
    const args = { command: "cat x" };
    const responder = new HITLResponder(
      new Map(),
      "auto",
      true,
      new Set(["Terminal"]), // nonConverging is keyed by the stored (recorded) name
      () => {},
    );
    // The live gate resolves to "Terminal" (not the "cat x" title), so the breaker engages.
    assert.equal(
      await responder.onPermission(permReqResolved("fresh", "Terminal", "cat x", args)),
      "deny",
    );
  });
});

describe("HITLResponder — stable spec.name anchor (name-drift fix)", () => {
  it("resumes when the stored key used the spec name but the re-raised gate only has a drifting title", async () => {
    // Park turn: the tool was stored under its canonical spec name (what the egress now writes).
    const decisions = new Map<string, PermissionDecision>([
      [parkedCallKey("commit_revision", { message: "hi" })!, "allow"],
    ]);
    const responder = new HITLResponder(decisions, "auto", true);
    // Re-raise: fresh id, NO ACP `name`, a display title that differs from the spec name.
    // The old `name -> title -> kind` chain would key on "Commit changes" and never match.
    assert.equal(
      await responder.onPermission(
        permReqWithSpec("fresh-id", "commit_revision", "Commit changes", {
          message: "hi",
        }),
      ),
      "allow",
      "spec.name anchors the resume even when the display title drifts",
    );
  });

  it("SECURITY: the spec-name anchor is still args-scoped (different args re-prompt)", async () => {
    const decisions = new Map<string, PermissionDecision>([
      [parkedCallKey("commit_revision", { message: "hi" })!, "allow"],
    ]);
    const responder = new HITLResponder(decisions, "auto", true);
    assert.equal(
      await responder.onPermission(
        permReqWithSpec("call-b", "commit_revision", "Commit changes", {
          message: "DIFFERENT",
        }),
      ),
      "park",
      "a different-args call must re-prompt even under the same spec name",
    );
  });
});

describe("nonConvergingToolNames — HITL resume loop detection", () => {
  // Build a transcript with `approves` {approved:true} envelopes and `execs` real results for
  // one tool, mirroring what the Vercel ingress folds onto each turn.
  function transcriptFor(
    name: string,
    approves: number,
    execs: number,
  ): AgentRunRequest {
    const content: any[] = [];
    for (let i = 0; i < approves; i++)
      content.push({
        type: "tool_result",
        toolCallId: `a-${i}`,
        toolName: name,
        output: { approved: true },
      });
    for (let i = 0; i < execs; i++)
      content.push({
        type: "tool_result",
        toolCallId: `e-${i}`,
        toolName: name,
        output: "real output",
      });
    return { messages: [{ role: "tool", content }] };
  }

  it("flags a tool approved repeatedly but never executed", () => {
    const looping = nonConvergingToolNames(transcriptFor("commit_revision", 3, 0));
    assert.ok(looping.has("commit_revision"));
  });

  it("does NOT flag a converging tool (each approval produced a real result)", () => {
    const looping = nonConvergingToolNames(transcriptFor("edit", 3, 3));
    assert.equal(looping.has("edit"), false);
  });

  it("does NOT flag below the threshold (a couple of retries are tolerated)", () => {
    const looping = nonConvergingToolNames(transcriptFor("bash", 2, 0));
    assert.equal(looping.has("bash"), false);
  });

  it("recovers the tool name from the correlated tool_call when the result omits it", () => {
    const request: AgentRunRequest = {
      messages: [
        {
          role: "assistant",
          content: [
            { type: "tool_call", toolCallId: "t1", toolName: "deploy" },
            { type: "tool_call", toolCallId: "t2", toolName: "deploy" },
            { type: "tool_call", toolCallId: "t3", toolName: "deploy" },
          ],
        },
        {
          role: "tool",
          content: [
            { type: "tool_result", toolCallId: "t1", output: { approved: true } },
            { type: "tool_result", toolCallId: "t2", output: { approved: true } },
            { type: "tool_result", toolCallId: "t3", output: { approved: true } },
          ],
        },
      ],
    };
    assert.ok(nonConvergingToolNames(request).has("deploy"));
  });
});

describe("HITLResponder — loop-breaker + diagnostics", () => {
  it("DENIES a gate whose tool is non-converging, instead of parking forever", async () => {
    const logs: string[] = [];
    // No stored decision matches (the drift), and the tool is flagged as looping.
    const responder = new HITLResponder(
      new Map(),
      "auto",
      true, // human surface -> would normally park
      new Set(["commit_revision"]),
      (m) => logs.push(m),
    );
    assert.equal(
      await responder.onPermission(
        permReqWithSpec("fresh", "commit_revision", "Commit changes", {
          message: "x",
        }),
      ),
      "deny",
      "the loop-breaker denies rather than re-parking",
    );
    assert.ok(
      logs.some((l) => l.includes("loop-breaker")),
      "the loop-break is logged for diagnostics",
    );
  });

  it("still parks a NON-looping tool with no stored decision (loop-breaker is scoped)", async () => {
    const responder = new HITLResponder(
      new Map(),
      "auto",
      true,
      new Set(["commit_revision"]),
      () => {},
    );
    assert.equal(
      await responder.onPermission(
        permReqWithSpec("fresh", "edit", "Edit file", { path: "a.txt" }),
      ),
      "park",
      "a different tool that is not looping still parks normally",
    );
  });

  it("logs a gate MISS when decisions are present but none match (drift diagnostic)", async () => {
    const logs: string[] = [];
    const decisions = new Map<string, PermissionDecision>([
      [parkedCallKey("edit", { path: "a.txt" })!, "allow"],
    ]);
    const responder = new HITLResponder(
      decisions,
      "auto",
      true,
      new Set(),
      (m) => logs.push(m),
    );
    // A gate that does not match the stored key -> park, but the miss is logged with both sides.
    await responder.onPermission(permReqWithSpec("fresh", "edit", "Edit", { path: "OTHER" }));
    assert.ok(
      logs.some((l) => l.includes("gate miss") && l.includes("stored=")),
      "the miss dumps live keys and stored keys",
    );
  });
});
