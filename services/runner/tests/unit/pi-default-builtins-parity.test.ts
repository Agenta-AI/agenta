/**
 * Cross-language parity for Pi's default active built-in set.
 *
 * Two implementations name the same four tools and must never drift:
 *  - TS: `PI_DEFAULT_ACTIVE_BUILTINS` in `../../src/engines/sandbox_agent/run-plan.ts`, the set
 *    the runner falls back to when a `/run` request omits `tools`, and the set
 *    `computeBuiltinGatingActive` compares a grant list against for the no-gating fast path.
 *  - Python: `PI_DEFAULT_ACTIVE_BUILTINS` in `agenta/sdk/agents/pi_builtins.py`, which the shipped
 *    default agent template builds its `tools` entries from.
 *
 * Neither language owns the list. Both sides assert the SAME shared fixture, loaded in place (no
 * copy) via `loadGolden`:
 * `sdks/python/oss/tests/pytest/unit/agents/golden/pi_default_active_builtins.json`. The Python
 * half asserts it in `sdks/python/oss/tests/pytest/unit/agents/test_pi_builtins_parity.py`. If the
 * two disagree, that is a real drift between the implementations, not a fixture bug — fix the side
 * that moved, do not bend the fixture.
 *
 * Run: pnpm test (or: pnpm exec vitest run tests/unit/pi-default-builtins-parity.test.ts)
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";

import { loadGolden } from "../utils/golden.ts";
import { PI_DEFAULT_ACTIVE_BUILTINS } from "../../src/engines/sandbox_agent/run-plan.ts";

const fixture = loadGolden("pi_default_active_builtins.json") as {
  names: string[];
};

describe("Pi default active built-ins parity fixture", () => {
  it("the runner constant matches the shared golden", () => {
    assert.deepEqual(PI_DEFAULT_ACTIVE_BUILTINS, fixture.names);
  });
});
