/**
 * Grant-list regression pin (0e71bd0f7a): a run whose `tools` omits `bash` must not grant it,
 * both at the `RunPlan` layer (`buildRunPlan`) and at the extension's active-tool-set layer
 * (`replaceActiveBuiltinTools`). This bug shipped once as a silently-dropped grant list; pin it
 * at both layers so it cannot recur unnoticed at either one.
 *
 * (The former relay permission-parity half of this file is gone with the relay permission
 * plane: Pi gates ride the extension's `ctx.ui.confirm` dialog onto the ACP permission plane.)
 *
 * Run: pnpm test (or: pnpm exec vitest run tests/unit/builtin-grant-list.test.ts)
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";

import type { AgentRunRequest } from "../../src/protocol.ts";
import { buildRunPlan } from "../../src/engines/sandbox_agent/run-plan.ts";
import { replaceActiveBuiltinTools } from "../../src/extensions/agenta.ts";

describe("grant-list regression pin (0e71bd0f7a)", () => {
  it("buildRunPlan excludes bash from builtinGrants and turns gating on when `tools` omits it", () => {
    const result = buildRunPlan(
      {
        harness: "pi_core",
        messages: [{ role: "user", content: "hello" }],
        tools: ["read"],
      } as AgentRunRequest,
      { createLocalCwd: () => "/tmp/local-cwd" },
    );

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.plan.builtinGrants, ["read"]);
    assert.ok(
      !result.plan.builtinGrants.includes("bash"),
      "bash must not be silently re-granted",
    );
    assert.equal(result.plan.builtinGatingActive, true);
  });

  it("replaceActiveBuiltinTools drops bash/edit/write and keeps read when only read is granted", () => {
    const allTools = [
      { name: "read" },
      { name: "bash" },
      { name: "edit" },
      { name: "write" },
      { name: "grep" },
      { name: "find" },
      { name: "ls" },
    ];

    const next = replaceActiveBuiltinTools(
      ["read", "bash", "edit", "write"],
      allTools,
      ["read"],
    );

    assert.deepEqual(next, ["read"]);
    assert.ok(!next.includes("bash"));
    assert.ok(!next.includes("edit"));
    assert.ok(!next.includes("write"));
  });
});
