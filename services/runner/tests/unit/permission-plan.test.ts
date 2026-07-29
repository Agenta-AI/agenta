import { afterEach, beforeEach, describe, it } from "vitest";
import assert from "node:assert/strict";

import {
  decide,
  effectivePermission,
  permissionsFromRequest,
  type GateDescriptor,
  type PermissionPlan,
  type StoredPermissionDecisions,
  type Verdict,
} from "../../src/permission-plan.ts";
import type { AgentRunRequest, PermissionMode, ToolPermission } from "../../src/protocol.ts";

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

const modes = ["allow", "ask", "deny", "allow_reads"] as const;
const permissions = ["allow", "ask", "deny", undefined] as const;
const hints = [true, false, undefined] as const;
const storedDecisions = ["allow", "deny", undefined] as const;

describe("decide truth table", () => {
  it("matches the reference behavior for every default/spec/hint/stored combination", () => {
    let cases = 0;
    for (const defaultMode of modes) {
      for (const specPermission of permissions) {
        for (const readOnlyHint of hints) {
          for (const storedDecision of storedDecisions) {
            const gate: GateDescriptor = {
              executor: "relay",
              toolName: "tool",
              specPermission,
              readOnlyHint,
              args: {},
            };
            const plan: PermissionPlan = { default: defaultMode, rules: [] };
            const stored: StoredPermissionDecisions = {
              take: () => storedDecision,
            };

            assert.deepEqual(
              decide(gate, plan, stored),
              { kind: expectedVerdict(defaultMode, specPermission, readOnlyHint, storedDecision) },
              `default=${defaultMode} spec=${specPermission ?? "unset"} readOnly=${String(
                readOnlyHint,
              )} stored=${storedDecision ?? "none"}`,
            );
            cases += 1;
          }
        }
      }
    }
    assert.equal(cases, 4 * 4 * 3 * 3);
  });

  const spotCases: Array<{
    name: string;
    gate: GateDescriptor;
    plan: PermissionPlan;
    stored?: "allow" | "deny";
    expected: Verdict;
  }> = [
    {
      name: "allow_reads + no hint + no stored asks",
      gate: { executor: "relay", readOnlyHint: undefined },
      plan: { default: "allow_reads", rules: [] },
      expected: { kind: "pendingApproval" },
    },
    {
      name: "allow_reads + false hint + stored allow allows",
      gate: { executor: "relay", readOnlyHint: false },
      plan: { default: "allow_reads", rules: [] },
      stored: "allow",
      expected: { kind: "allow" },
    },
    {
      name: "allow_reads + true hint ignores stored deny",
      gate: { executor: "relay", readOnlyHint: true },
      plan: { default: "allow_reads", rules: [] },
      stored: "deny",
      expected: { kind: "allow" },
    },
    {
      name: "deny default ignores stored allow",
      gate: { executor: "harness" },
      plan: { default: "deny", rules: [] },
      stored: "allow",
      expected: { kind: "deny" },
    },
    {
      name: "ask default consumes stored deny",
      gate: { executor: "client" },
      plan: { default: "ask", rules: [] },
      stored: "deny",
      expected: { kind: "deny" },
    },
    {
      name: "allow default ignores stored deny",
      gate: { executor: "relay" },
      plan: { default: "allow", rules: [] },
      stored: "deny",
      expected: { kind: "allow" },
    },
    {
      name: "spec allow beats deny default",
      gate: { executor: "relay", specPermission: "allow" },
      plan: { default: "deny", rules: [] },
      expected: { kind: "allow" },
    },
    {
      name: "spec deny beats allow default and stored allow",
      gate: { executor: "relay", specPermission: "deny" },
      plan: { default: "allow", rules: [] },
      stored: "allow",
      expected: { kind: "deny" },
    },
    {
      name: "spec ask beats allow default",
      gate: { executor: "relay", specPermission: "ask" },
      plan: { default: "allow", rules: [] },
      expected: { kind: "pendingApproval" },
    },
  ];

  for (const { name, gate, plan, stored, expected } of spotCases) {
    it(name, () => {
      assert.deepEqual(decide(gate, plan, { take: () => stored }), expected);
    });
  }
});

describe("effectivePermission rule matching", () => {
  it("matches an exact tool name", () => {
    assert.equal(
      effectivePermission(
        { executor: "harness", toolName: "Bash" },
        { default: "deny", rules: [{ pattern: "Bash", permission: "allow" }] },
      ),
      "allow",
    );
  });

  it("matches Claude prefix rules against the first string argument", () => {
    assert.equal(
      effectivePermission(
        {
          executor: "harness",
          toolName: "Bash",
          args: { command: "npm run test" },
        },
        {
          default: "deny",
          rules: [{ pattern: "Bash(npm run:*)", permission: "allow" }],
        },
      ),
      "allow",
    );
  });

  it("does not match prefix rules when args are not inspectable", () => {
    assert.equal(
      effectivePermission(
        { executor: "harness", toolName: "Bash", args: { command: 42 } },
        {
          default: "deny",
          rules: [{ pattern: "Bash(npm run:*)", permission: "allow" }],
        },
      ),
      "deny",
    );
  });

  it("chooses deny over ask over allow when several rules match", () => {
    assert.equal(
      effectivePermission(
        {
          executor: "harness",
          toolName: "Bash",
          args: { command: "npm run test" },
        },
        {
          default: "allow",
          rules: [
            { pattern: "Bash", permission: "allow" },
            { pattern: "Bash(npm:*)", permission: "ask" },
            { pattern: "Bash(npm run:*)", permission: "deny" },
          ],
        },
      ),
      "deny",
    );
  });

  it("lets serverPermission beat rules", () => {
    assert.equal(
      effectivePermission(
        { executor: "relay", toolName: "fetch", serverPermission: "allow" },
        { default: "ask", rules: [{ pattern: "fetch", permission: "deny" }] },
      ),
      "allow",
    );
  });

  it("lets specPermission beat serverPermission", () => {
    assert.equal(
      effectivePermission(
        {
          executor: "relay",
          toolName: "fetch",
          specPermission: "deny",
          serverPermission: "allow",
        },
        { default: "ask", rules: [{ pattern: "fetch", permission: "allow" }] },
      ),
      "deny",
    );
  });
});

describe("permissionsFromRequest", () => {
  it("passes through a new block and normalizes missing pieces", () => {
    assert.deepEqual(
      permissionsFromRequest({
        permissions: {
          rules: [{ pattern: "Bash(npm run:*)", permission: "ask" }],
        },
      } as AgentRunRequest),
      {
        default: "allow_reads",
        rules: [{ pattern: "Bash(npm run:*)", permission: "ask" }],
      },
    );

    assert.deepEqual(
      permissionsFromRequest({
        permissions: { default: "deny" },
      } as AgentRunRequest),
      { default: "deny", rules: [] },
    );
  });

  it("treats an unknown mode as ask", () => {
    assert.deepEqual(
      permissionsFromRequest({
        permissions: {
          default: "bogus" as PermissionMode,
          rules: [{ pattern: "Bash", permission: "allow" }],
        },
      } as AgentRunRequest),
      { default: "ask", rules: [] },
    );
  });

  it("maps absent block to the safe SDK default", () => {
    assert.deepEqual(permissionsFromRequest({} as AgentRunRequest), {
      default: "allow_reads",
      rules: [],
    });
  });

  it("lets the env kill-switch beat an explicit allow block", () => {
    const previous = process.env.SANDBOX_AGENT_DENY_PERMISSIONS;
    try {
      process.env.SANDBOX_AGENT_DENY_PERMISSIONS = "true";
      assert.deepEqual(
        permissionsFromRequest({
          permissions: { default: "allow", rules: [{ pattern: "Bash", permission: "allow" }] },
        } as AgentRunRequest),
        { default: "deny", rules: [] },
      );
    } finally {
      if (previous === undefined) {
        delete process.env.SANDBOX_AGENT_DENY_PERMISSIONS;
      } else {
        process.env.SANDBOX_AGENT_DENY_PERMISSIONS = previous;
      }
    }
  });
});

describe("stored decisions", () => {
  it("consults stored decisions only under ask", () => {
    const stored: StoredPermissionDecisions = {
      take: () => {
        throw new Error("stored decision was consulted");
      },
    };

    assert.deepEqual(
      decide({ executor: "relay" }, { default: "allow", rules: [] }, stored),
      { kind: "allow" },
    );
    assert.deepEqual(
      decide({ executor: "relay" }, { default: "deny", rules: [] }, stored),
      { kind: "deny" },
    );
    assert.deepEqual(
      decide(
        { executor: "relay", specPermission: "allow" },
        { default: "ask", rules: [] },
        stored,
      ),
      { kind: "allow" },
    );
    assert.deepEqual(
      decide(
        { executor: "relay", specPermission: "deny" },
        { default: "ask", rules: [] },
        stored,
      ),
      { kind: "deny" },
    );
  });
});

function expectedVerdict(
  defaultMode: PermissionMode,
  specPermission: ToolPermission | undefined,
  readOnlyHint: boolean | undefined,
  storedDecision: "allow" | "deny" | undefined,
): Verdict["kind"] {
  const permission = expectedPermission(defaultMode, specPermission, readOnlyHint);
  if (permission === "allow") return "allow";
  if (permission === "deny") return "deny";
  return storedDecision ?? "pendingApproval";
}

function expectedPermission(
  defaultMode: PermissionMode,
  specPermission: ToolPermission | undefined,
  readOnlyHint: boolean | undefined,
): ToolPermission {
  if (specPermission !== undefined) return specPermission;
  if (defaultMode === "allow_reads") {
    return readOnlyHint === true ? "allow" : "ask";
  }
  return defaultMode;
}
