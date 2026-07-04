/**
 * Cross-language permission-decision parity.
 *
 * Two implementations resolve effective permissions and must never drift:
 *  - TS (enforcement truth): `effectivePermission` / `decide` in `../../src/permission-plan.ts`.
 *  - Python (feeds the Claude settings renderer): `effective_permission` in
 *    `sdks/python/agenta/sdk/agents/tools/models.py`.
 *
 * Both sides assert the SAME shared fixture, loaded in place (no copy) via `loadGolden`:
 * `sdks/python/oss/tests/pytest/unit/agents/golden/permission_decisions.json`. The Python side
 * asserts it in `sdks/python/oss/tests/pytest/unit/agents/tools/test_permission_parity.py`. If a
 * case here disagrees with the Python assertion, that is a real behavioral drift between the two
 * implementations, not a fixture bug — do not bend the fixture to make it pass.
 *
 * Run: pnpm test (or: pnpm exec vitest run tests/unit/permission-parity.test.ts)
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";

import { loadGolden } from "../utils/golden.ts";
import {
  decide,
  effectivePermission,
  type GateDescriptor,
  type PermissionPlan,
  type StoredPermissionDecisions,
  type Verdict,
} from "../../src/permission-plan.ts";
import type { ToolPermission } from "../../src/protocol.ts";

interface FixtureCase {
  name: string;
  gate: GateDescriptor;
  plan: { default: PermissionPlan["default"]; rules?: PermissionPlan["rules"] };
  stored?: "allow" | "deny";
  expected: { effective: ToolPermission; verdict: Verdict["kind"] };
  python: boolean;
}

const fixture = loadGolden("permission_decisions.json") as {
  cases: FixtureCase[];
};

describe("permission decision parity fixture", () => {
  it("has at least 36 cases", () => {
    assert.ok(
      fixture.cases.length >= 36,
      `expected >= 36 cases, got ${fixture.cases.length}`,
    );
  });

  for (const testCase of fixture.cases) {
    it(testCase.name, () => {
      const plan: PermissionPlan = {
        default: testCase.plan.default,
        rules: testCase.plan.rules ?? [],
      };

      assert.equal(
        effectivePermission(testCase.gate, plan),
        testCase.expected.effective,
        "effectivePermission mismatch",
      );

      let consulted = false;
      const stored: StoredPermissionDecisions = {
        take: () => {
          consulted = true;
          return testCase.stored;
        },
      };

      const verdict = decide(testCase.gate, plan, stored);
      assert.equal(
        verdict.kind,
        testCase.expected.verdict,
        "decide verdict mismatch",
      );

      // Stored decisions must only ever be consulted when the effective permission is
      // neither "allow" nor "deny" (i.e. it's "ask"). This is the config-beats-stale-approval
      // invariant: an effective allow/deny from spec/server/rule/default must never let a
      // stored (possibly stale) human decision override it.
      const expectConsulted = testCase.expected.effective === "ask";
      assert.equal(
        consulted,
        expectConsulted,
        expectConsulted
          ? "expected the stored decision to be consulted"
          : "stored decision must NOT be consulted when the effective permission is allow/deny",
      );
    });
  }
});
