import { describe, expect, it } from "vitest";
import { permissionsModel } from "../../model";
import type { PermissionTestVector } from "../../model/types";
import {
  decide,
  decideClientTool,
  planFromConfig,
  StoredDecisionStore,
  type GateDescriptor,
  type ToolPermission,
} from "./decide";

/**
 * config.storedDecision in permissions.json is a human-readable sentence
 * ("allow (from a prior turn's approval, keyed by ...)"), not a machine
 * shape, because the model file is meant to be read by people too. Only the
 * leading word ("allow" | "deny") is load-bearing for the vector; everything
 * after it is prose explaining the anchor. Extract just that word.
 */
function parseStoredDecisionWord(text: string | undefined): "allow" | "deny" | undefined {
  if (!text) return undefined;
  const match = /^(allow|deny)\b/.exec(text.trim());
  return match ? (match[1] as "allow" | "deny") : undefined;
}

function buildGate(vector: PermissionTestVector): GateDescriptor {
  return {
    toolName: vector.gate.toolName,
    readOnlyHint: vector.gate.readOnlyHint,
    specPermission: vector.gate.specPermission as ToolPermission | undefined,
    serverPermission: vector.gate.serverPermission as ToolPermission | undefined,
    args: vector.gate.args,
  };
}

describe("decide() reproduces every permissions.json testVector", () => {
  const vectors = permissionsModel.testVectors;

  it("the model actually ships test vectors (a sanity floor for this suite)", () => {
    expect(vectors.length).toBeGreaterThanOrEqual(12);
  });

  for (const vector of vectors) {
    it(`${vector.id} (${vector.tool}) -> ${vector.expectedVerdict} :: ${vector.decidedBy}`, () => {
      const { plan } = planFromConfig({
        permissions: vector.config.permissions,
        env: vector.config.env,
      });
      const gate = buildGate(vector);

      const store = new StoredDecisionStore();
      const storedWord = parseStoredDecisionWord(vector.config.storedDecision);
      if (storedWord) {
        store.record(gate.toolName, gate.args, storedWord);
      }

      const verdict = decide(gate, plan, store);
      expect(verdict.kind, `${vector.id}: expected ${vector.expectedVerdict}, decidedBy "${vector.decidedBy}"`).toBe(
        vector.expectedVerdict,
      );
    });
  }

  it("TV12's stored decision is consumed once: a second identical call asks again", () => {
    const tv12 = vectors.find((v) => v.id === "TV12");
    expect(tv12).toBeDefined();
    const { plan } = planFromConfig({ permissions: tv12!.config.permissions });
    const gate = buildGate(tv12!);

    const store = new StoredDecisionStore();
    store.record(gate.toolName, gate.args, "allow");

    const first = decide(gate, plan, store);
    expect(first.kind).toBe("allow");
    expect(first.rung).toBe("storedDecision");

    const second = decide(gate, plan, store);
    expect(second.kind).toBe("pendingApproval");
  });

  it("TV13/TV14 confirm the kill-switch scope nuance directly against effectivePermission", () => {
    const withoutSpec = vectors.find((v) => v.id === "TV13")!;
    const withSpec = vectors.find((v) => v.id === "TV14")!;

    const { plan: forcedPlan, rung: planRung } = planFromConfig({
      permissions: withoutSpec.config.permissions,
      env: withoutSpec.config.env,
    });
    expect(planRung).toBe("killSwitch");
    expect(forcedPlan).toEqual({ default: "deny", rules: [] });

    const deny = decide(buildGate(withoutSpec), forcedPlan, new StoredDecisionStore());
    expect(deny.kind).toBe("deny");
    expect(deny.rung).toBe("policyDefault");

    const allow = decide(buildGate(withSpec), forcedPlan, new StoredDecisionStore());
    expect(allow.kind).toBe("allow");
    expect(allow.rung).toBe("specPermission");
  });
});

/**
 * decideClientTool() has no local "allow" outcome: deny (explicit or derived
 * from a deny plan default) is the only way out other than pendingApproval.
 * Ported from ApprovalResponder.onClientTool() in responder.ts; see the
 * function's own doc comment for the exact mirrored branches.
 */
describe("decideClientTool() mirrors onClientTool()'s deny/pendingApproval split", () => {
  const gate: GateDescriptor = { toolName: "request_connection" };

  it("an explicit specPermission=deny denies, regardless of the policy default", () => {
    const { plan } = planFromConfig({ permissions: { default: "allow" } });
    const verdict = decideClientTool({ ...gate, specPermission: "deny" }, plan);
    expect(verdict.kind).toBe("deny");
    expect(verdict.rung).toBe("specPermission");
  });

  it("a deny policy default denies a client tool with no explicit permission", () => {
    const { plan } = planFromConfig({ permissions: { default: "deny" } });
    const verdict = decideClientTool(gate, plan);
    expect(verdict.kind).toBe("deny");
    expect(verdict.rung).toBe("policyDefault");
  });

  it("an explicit specPermission=allow still pauses: pendingApproval, never a local allow", () => {
    const { plan } = planFromConfig({ permissions: { default: "deny" } });
    const verdict = decideClientTool({ ...gate, specPermission: "allow" }, plan);
    expect(verdict.kind).toBe("pendingApproval");
    expect(verdict.rung).toBe("specPermission");
  });

  it("no explicit permission under allow_reads (or any non-deny default) also pauses: pendingApproval", () => {
    const { plan } = planFromConfig({ permissions: { default: "allow_reads" } });
    const verdict = decideClientTool(gate, plan);
    expect(verdict.kind).toBe("pendingApproval");
    expect(verdict.rung).toBe("policyDefault");
  });

  it("a stored deny decision can also deny an ask-derived permission", () => {
    const { plan } = planFromConfig({ permissions: { default: "ask" } });
    const store = new StoredDecisionStore();
    store.record(gate.toolName, gate.args, "deny");
    const verdict = decideClientTool({ ...gate, specPermission: "ask" }, plan, store);
    expect(verdict.kind).toBe("deny");
    expect(verdict.rung).toBe("storedDecision");
  });
});
