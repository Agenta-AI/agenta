/**
 * Pi built-ins are activated unconditionally, so the request's deprecated `tools` field cannot
 * influence a run and gating follows the permission policy alone. This replaces the grant-list
 * regression pin (0e71bd0f7a): the bug it guarded — a grant list that silently dropped a tool —
 * is no longer expressible.
 *
 * Run: pnpm test (or: pnpm exec vitest run tests/unit/pi-builtin-activation.test.ts)
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";

import type { AgentRunRequest } from "../../src/protocol.ts";
import { buildRunPlan } from "../../src/engines/sandbox_agent/run-plan.ts";
import { replaceActiveBuiltinTools } from "../../src/extensions/agenta.ts";

const ALL_BUILTIN_TOOLS = [
  { name: "read" },
  { name: "bash" },
  { name: "edit" },
  { name: "write" },
  { name: "grep" },
  { name: "find" },
  { name: "ls" },
];

function planFor(request: Partial<AgentRunRequest>) {
  const result = buildRunPlan(
    {
      harness: "pi_core",
      messages: [{ role: "user", content: "hello" }],
      ...request,
    } as AgentRunRequest,
    { createLocalCwd: () => "/tmp/local-cwd" },
  );
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("plan failed");
  return result.plan;
}

describe("the deprecated `tools` field does not influence the plan", () => {
  const permissions = { default: "allow", rules: [] };

  for (const tools of [
    undefined,
    [],
    ["read"],
    ["nonsense"],
    ["read", "bash", "edit", "write", "grep", "find", "ls"],
  ]) {
    it(`produces the same gating decision for tools=${JSON.stringify(tools)}`, () => {
      const plan = planFor({ permissions, tools } as Partial<AgentRunRequest>);
      assert.equal(plan.tools.builtinGatingActive, false);
      assert.equal(plan.tools.useToolRelay, false);
    });
  }
});

describe("builtin gating follows the permission policy alone", () => {
  it("stays off under a blanket allow with no builtin rules", () => {
    assert.equal(
      planFor({ permissions: { default: "allow", rules: [] } }).tools
        .builtinGatingActive,
      false,
    );
  });

  it("turns on under allow_reads", () => {
    assert.equal(
      planFor({ permissions: { default: "allow_reads", rules: [] } }).tools
        .builtinGatingActive,
      true,
    );
  });

  it("turns on when a rule names a builtin, whatever its case", () => {
    assert.equal(
      planFor({
        permissions: {
          default: "allow",
          rules: [{ pattern: "bash(npm:*)", permission: "deny" }],
        },
      }).tools.builtinGatingActive,
      true,
    );
  });
});

describe("replaceActiveBuiltinTools activates every builtin the harness reports", () => {
  it("adds the three Pi does not activate on its own", () => {
    const next = replaceActiveBuiltinTools(
      ["read", "bash", "edit", "write"],
      ALL_BUILTIN_TOOLS,
    );
    assert.deepEqual(next, [
      "read",
      "bash",
      "edit",
      "write",
      "grep",
      "find",
      "ls",
    ]);
  });

  it("keeps non-builtin tools and the position of the builtin slice", () => {
    const next = replaceActiveBuiltinTools(
      ["my_tool", "read", "write", "other_tool"],
      [...ALL_BUILTIN_TOOLS, { name: "my_tool" }, { name: "other_tool" }],
    );
    assert.deepEqual(next, [
      "my_tool",
      "read",
      "bash",
      "edit",
      "write",
      "grep",
      "find",
      "ls",
      "other_tool",
    ]);
  });

  it("does not duplicate a builtin reported twice", () => {
    const next = replaceActiveBuiltinTools(
      ["read"],
      [{ name: "read" }, { name: "read" }, { name: "grep" }],
    );
    assert.deepEqual(next, ["read", "grep"]);
  });

  it("leaves the non-builtin remainder alone when the harness reports no builtins", () => {
    const next = replaceActiveBuiltinTools(["my_tool", "read"], []);
    assert.deepEqual(next, ["my_tool"]);
  });
});
