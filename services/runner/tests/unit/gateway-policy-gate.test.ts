/**
 * The gateway policy gate: qa.md R1 to R8b.
 *
 * The gate is the authorization boundary for the two runtime tools. Their specifications carry
 * `permission: "allow"`, which only opens the coarse harness gate, so everything that decides
 * whether an integration tool may run is exercised here: the compiled permission, a missing
 * integration or key, and the operator kill-switch.
 *
 * R6, R7 and R8 are the operator-override correction. Before it, the switch only replaced the
 * plan default and was read once at run start, so an explicit `allow` beat it and a mid-run flip
 * never reached a live run. R8b is the third half of the same hole: client tools do not call the
 * shared decision function at all.
 *
 * Run: pnpm exec vitest run tests/unit/gateway-policy-gate.test.ts
 */
import { afterEach, beforeEach, describe, it } from "vitest";
import assert from "node:assert/strict";

import {
  ApprovalResponder,
  ConversationDecisions,
  approvedCallKey,
} from "../../src/responder.ts";
import { planGatewayRun } from "../../src/tools/gateway-policy.ts";
import type { GatewayRunPlan } from "../../src/tools/gateway-policy.ts";
import {
  EMPTY_POLICY,
  NORMALIZED_POLICY,
  buildTestGatewayGate,
  interactionRequests,
} from "../utils/gateway.ts";

const originalDenyEnv = process.env.SANDBOX_AGENT_DENY_PERMISSIONS;

beforeEach(() => {
  delete process.env.SANDBOX_AGENT_DENY_PERMISSIONS;
});

afterEach(() => {
  if (originalDenyEnv === undefined) {
    delete process.env.SANDBOX_AGENT_DENY_PERMISSIONS;
  } else {
    process.env.SANDBOX_AGENT_DENY_PERMISSIONS = originalDenyEnv;
  }
});

function allowedPlan(
  integration: string,
  tool: string,
  args: Record<string, unknown> = {},
): Extract<GatewayRunPlan, { ok: true }> {
  const plan = planGatewayRun(
    { integration, tool, arguments: args },
    NORMALIZED_POLICY,
  );
  assert.ok(plan.ok, `expected ${integration}.${tool} to resolve`);
  return plan;
}

async function runGate(
  harness: ReturnType<typeof buildTestGatewayGate>,
  integration: string,
  tool: string,
  args: Record<string, unknown> = {},
) {
  const plan = allowedPlan(integration, tool, args);
  return harness.gate.onGatewayRun({
    id: `token-${integration}-${tool}`,
    toolCallId: `call-${integration}-${tool}`,
    toolName: "run_tool",
    input: { integration, tool, arguments: args },
    plan,
  });
}

describe("the compiled permission decides (R1 to R3)", () => {
  it("R1: a compiled deny is refused and never reaches a callback", async () => {
    const harness = buildTestGatewayGate();
    const verdict = await runGate(harness, "github", "DELETE_REPOSITORY");

    assert.equal(verdict.kind, "deny");
    assert.equal(harness.events.length, 0, "a denied call raises no card");
    assert.equal(harness.interactions.length, 0);
    assert.equal(harness.pauses, 0);
  });

  it("R2: a compiled allow runs with no approval card", async () => {
    const harness = buildTestGatewayGate();
    const verdict = await runGate(harness, "github", "GET_ISSUE", {
      issue: 12,
    });

    assert.deepEqual(verdict, { kind: "allow" });
    assert.equal(harness.events.length, 0);
    assert.equal(harness.interactions.length, 0);
  });

  it("R3: a compiled ask creates a user_approval interaction and pauses the turn", async () => {
    const harness = buildTestGatewayGate();
    const verdict = await runGate(harness, "github", "CREATE_ISSUE", {
      title: "bug",
    });

    assert.deepEqual(verdict, { kind: "pendingApproval" });
    assert.equal(harness.interactions.length, 1);
    assert.equal(harness.interactions[0].kind, "user_approval");
    const [event] = interactionRequests(harness.events);
    assert.equal(harness.events.length, 1);
    assert.equal(event.kind, "user_approval");

    // The seam pauses through the gate's own hook, the way every other relay pause does.
    harness.gate.onPause?.();
    assert.equal(harness.pauses, 1);
    assert.equal(
      harness.nonParkable,
      1,
      "a relay-seam approval has no ACP gate for the live resume to answer",
    );
  });
});

describe("absence is never permission (R4, R5)", () => {
  it("R4: an integration absent from the resolved policy is a deny", () => {
    const plan = planGatewayRun(
      { integration: "stripe", tool: "CREATE_CHARGE", arguments: {} },
      NORMALIZED_POLICY,
    );
    assert.equal(plan.ok, false);
  });

  it("R5: a tool key absent from the resolved policy is a deny", () => {
    const plan = planGatewayRun(
      { integration: "github", tool: "FORCE_PUSH", arguments: {} },
      NORMALIZED_POLICY,
    );
    assert.equal(plan.ok, false);
  });

  it("an empty policy denies every integration tool", () => {
    assert.equal(
      planGatewayRun(
        { integration: "github", tool: "GET_ISSUE", arguments: {} },
        EMPTY_POLICY,
      ).ok,
      false,
    );
  });

  it("neither refusal names the integration, the key, or what is available", () => {
    for (const args of [
      { integration: "stripe", tool: "CREATE_CHARGE", arguments: {} },
      { integration: "github", tool: "FORCE_PUSH", arguments: {} },
    ]) {
      const plan = planGatewayRun(args, NORMALIZED_POLICY);
      assert.equal(plan.ok, false);
      const reason = (plan as { reason: string }).reason;
      for (const leak of [
        "stripe",
        "FORCE_PUSH",
        "GET_ISSUE",
        "CREATE_ISSUE",
        "slack",
        "github-work",
      ]) {
        assert.ok(
          !reason.includes(leak),
          `a refusal must not name '${leak}': ${reason}`,
        );
      }
    }
  });
});

describe("the operator override (R6, R7, R8, R8b)", () => {
  it("R6: an operator deny beats a compiled allow", async () => {
    const harness = buildTestGatewayGate();
    process.env.SANDBOX_AGENT_DENY_PERMISSIONS = "true";

    const verdict = await runGate(harness, "github", "GET_ISSUE");

    assert.equal(
      verdict.kind,
      "deny",
      "the switch is a top-priority condition, not a replacement for the plan default",
    );
    assert.equal(harness.events.length, 0);
  });

  it("R7: an operator deny beats a stored allow answer", async () => {
    const key = approvedCallKey("run_tool", {
      integration: "github",
      tool: "CREATE_ISSUE",
      arguments: { title: "bug" },
    });
    assert.ok(key);
    const harness = buildTestGatewayGate({
      storedDecisions: new Map([[key, "allow"]]),
    });

    // Without the switch, the stored answer settles this call.
    const allowed = await runGate(harness, "github", "CREATE_ISSUE", {
      title: "bug",
    });
    assert.deepEqual(allowed, { kind: "allow" });

    const denied = buildTestGatewayGate({
      storedDecisions: new Map([[key, "allow"]]),
    });
    process.env.SANDBOX_AGENT_DENY_PERMISSIONS = "true";
    const verdict = await runGate(denied, "github", "CREATE_ISSUE", {
      title: "bug",
    });

    assert.equal(
      verdict.kind,
      "deny",
      "order is operator deny, then the compiled permission, then a stored answer",
    );
  });

  it("R8: the switch reaches a run that already started", async () => {
    // ONE harness, so the permission plan and the responder are the ones built at run start.
    const harness = buildTestGatewayGate();

    const before = await runGate(harness, "github", "GET_ISSUE");
    assert.deepEqual(before, { kind: "allow" });

    process.env.SANDBOX_AGENT_DENY_PERMISSIONS = "true";
    const after = await runGate(harness, "github", "GET_ISSUE");

    assert.equal(
      after.kind,
      "deny",
      "the switch is read at decision time, not captured in the plan at run start",
    );
  });

  it("R8b: the switch reaches a client tool, which takes a different path", async () => {
    const responder = new ApprovalResponder(
      { default: "allow_reads", rules: [] },
      new ConversationDecisions(new Map()),
    );
    const request = {
      id: "client-1",
      gate: {
        executor: "client" as const,
        toolName: "request_connection",
        specPermission: "allow" as const,
        args: { integration: "github" },
      },
    };

    assert.deepEqual(await responder.onClientTool(request), {
      kind: "pendingApproval",
    });

    process.env.SANDBOX_AGENT_DENY_PERMISSIONS = "true";
    assert.deepEqual(
      await responder.onClientTool(request),
      { kind: "deny" },
      "client tools never call effectivePermission, so the fix must reach them separately",
    );
  });
});

describe("the shape is checked before anyone is asked (R29 at the decision)", () => {
  for (const [label, args] of [
    ["a string", "channel=#general"],
    ["an array", ["#general"]],
    ["null", null],
    ["a number", 7],
  ] as const) {
    it(`refuses run_tool whose nested arguments is ${label}`, async () => {
      const harness = buildTestGatewayGate();
      const plan = planGatewayRun(
        { integration: "github", tool: "CREATE_ISSUE", arguments: args },
        NORMALIZED_POLICY,
      );

      assert.equal(plan.ok, false, "presence is not a type check");
      assert.equal(
        harness.events.length,
        0,
        "the refusal happens before the approval card, never after it",
      );
    });
  }

  it("refuses a run_tool call whose integration or tool is not a string", () => {
    assert.equal(
      planGatewayRun(
        { integration: 12, tool: "GET_ISSUE", arguments: {} },
        NORMALIZED_POLICY,
      ).ok,
      false,
    );
    assert.equal(
      planGatewayRun(
        { integration: "github", tool: null, arguments: {} },
        NORMALIZED_POLICY,
      ).ok,
      false,
    );
  });
});

describe("the resolved call carries private routing the model never sent", () => {
  it("reads the provider and the connection from the policy", () => {
    const plan = allowedPlan("slack", "SEND_MESSAGE", { text: "hi" });
    assert.deepEqual(plan.context, {
      provider: "composio",
      integration: "slack",
      connection: "slack-main",
      tool: "SEND_MESSAGE",
    });
    assert.deepEqual(plan.target.arguments, { text: "hi" });
  });

  it("ignores a connection the model tried to supply", () => {
    const plan = planGatewayRun(
      {
        integration: "github",
        tool: "GET_ISSUE",
        arguments: { issue: 1 },
        connection: "attacker-owned",
        provider: "attacker",
      },
      NORMALIZED_POLICY,
    );
    assert.ok(plan.ok);
    assert.equal(plan.context.connection, "github-work");
    assert.equal(plan.context.provider, "composio");
  });
});
