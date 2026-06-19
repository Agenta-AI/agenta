/**
 * Unit tests for the interaction responder seam and the otel `emitEvent` hook.
 *
 * Covers the behavior parity of the responder (it replaces the old inline auto-approve in
 * rivet.ts) and that an out-of-stream event (an `interaction_request`) routed through
 * `emitEvent` lands in both the live sink and the batch `events()` log. No harness, no
 * network.
 *
 * Run: pnpm exec tsx test/responder.test.ts
 */
import assert from "node:assert/strict";

import { createRivetOtel } from "../src/tracing/otel.ts";
import type { AgentEvent } from "../src/protocol.ts";
import {
  PolicyResponder,
  decisionToReply,
  policyFromRequest,
} from "../src/responder.ts";

// --- policyFromRequest -------------------------------------------------------
{
  delete process.env.AGENTA_RIVET_DENY_PERMISSIONS;
  assert.equal(policyFromRequest(undefined), "auto");
  assert.equal(policyFromRequest("auto"), "auto");
  assert.equal(policyFromRequest("deny"), "deny");

  process.env.AGENTA_RIVET_DENY_PERMISSIONS = "true";
  assert.equal(policyFromRequest(undefined), "deny", "env forces deny");
  assert.equal(policyFromRequest("auto"), "deny", "env overrides auto");
  delete process.env.AGENTA_RIVET_DENY_PERMISSIONS;
}

// --- decisionToReply (parity with the old inline mapping) --------------------
{
  assert.equal(decisionToReply("allow", ["always", "once", "reject"]), "always");
  assert.equal(decisionToReply("allow", ["once", "reject"]), "once");
  assert.equal(decisionToReply("allow", []), "once", "allow falls back to once");
  assert.equal(decisionToReply("deny", ["always", "once", "reject"]), "reject");
  assert.equal(decisionToReply("deny", []), "reject", "deny falls back to reject");
}

// --- PolicyResponder ---------------------------------------------------------
{
  const auto = new PolicyResponder("auto");
  const deny = new PolicyResponder("deny");
  const req = { id: "p1", availableReplies: ["once", "reject"] };
  assert.equal(await auto.onPermission(req), "allow");
  assert.equal(await deny.onPermission(req), "deny");
}

// --- emitEvent: streaming path (sink + batch) --------------------------------
{
  const emitted: AgentEvent[] = [];
  const run = createRivetOtel({ harness: "claude", model: "anthropic/x", emit: (e) => emitted.push(e) });
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
}

// --- emitEvent: one-shot path (batch only) -----------------------------------
{
  const run = createRivetOtel({ harness: "claude", model: "anthropic/x" });
  run.start({ prompt: "hi" });
  run.emitEvent({ type: "data", name: "weather", data: { temp: 24 } });
  const ev = run.events().find((e) => e.type === "data");
  assert.ok(ev, "data event recorded with no live sink");
  assert.equal((ev as any).name, "weather");
}

console.log("responder.test.ts: all assertions passed");
