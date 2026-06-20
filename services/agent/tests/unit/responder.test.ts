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
import type { AgentEvent } from "../../src/protocol.ts";
import {
  PolicyResponder,
  decisionToReply,
  policyFromRequest,
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
    assert.equal(decisionToReply("allow", ["always", "once", "reject"]), "always");
    assert.equal(decisionToReply("allow", ["once", "reject"]), "once");
    assert.equal(decisionToReply("allow", []), "once", "allow falls back to once");
    assert.equal(decisionToReply("deny", ["always", "once", "reject"]), "reject");
    assert.equal(decisionToReply("deny", []), "reject", "deny falls back to reject");
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

describe("emitEvent", () => {
  it("streaming path: flushes to the live sink and the batch log", () => {
    const emitted: AgentEvent[] = [];
    const run = createSandboxAgentOtel({ harness: "claude", model: "anthropic/x", emit: (e) => emitted.push(e) });
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
    const run = createSandboxAgentOtel({ harness: "claude", model: "anthropic/x" });
    run.start({ prompt: "hi" });
    run.emitEvent({ type: "data", name: "weather", data: { temp: 24 } });
    const ev = run.events().find((e) => e.type === "data");
    assert.ok(ev, "data event recorded with no live sink");
    assert.equal((ev as any).name, "weather");
  });
});
