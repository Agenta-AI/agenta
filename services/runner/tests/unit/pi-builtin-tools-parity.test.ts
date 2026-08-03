/**
 * Cross-language parity for the Pi built-in tool table.
 *
 * Two implementations name the same seven tools and must never drift:
 *  - TS: `PI_BUILTIN_TOOL_IDENTITY` in `../../src/permission-plan.ts`, the set the runner
 *    activates on every Pi run and matches permission rules against.
 *  - Python: `PI_BUILTIN_TOOL_NAMES` in `agenta/sdk/agents/pi_builtins.py`, which the SDK sends
 *    on the wire for compatibility with older runners.
 *
 * Neither language owns the list. Both sides assert the SAME shared fixture, loaded in place (no
 * copy) via `loadGolden`:
 * `sdks/python/oss/tests/pytest/unit/agents/golden/pi_builtin_tools.json`. The Python half
 * asserts it in `sdks/python/oss/tests/pytest/unit/agents/test_pi_builtins_parity.py` and covers
 * the names only; the canonical rule names and the read-only flags are pinned here because the
 * runner owns them. If the two disagree, that is a real drift between the implementations, not a
 * fixture bug — fix the side that moved, do not bend the fixture.
 *
 * Run: pnpm test (or: pnpm exec vitest run tests/unit/pi-builtin-tools-parity.test.ts)
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";

import { loadGolden } from "../utils/golden.ts";
import { PI_BUILTIN_TOOL_IDENTITY } from "../../src/permission-plan.ts";
import { PI_BUILTIN_TOOL_NAMES as EXTENSION_BUILTIN_TOOL_NAMES } from "../../src/extensions/agenta.ts";

const fixture = loadGolden("pi_builtin_tools.json") as {
  builtins: { name: string; ruleName: string; readOnly: boolean }[];
};

describe("Pi built-in tool table parity fixture", () => {
  it("the runner identity table matches the shared golden", () => {
    const expected = Object.fromEntries(
      fixture.builtins.map((b) => [
        b.name,
        { ruleName: b.ruleName, readOnly: b.readOnly },
      ]),
    );
    assert.deepEqual(PI_BUILTIN_TOOL_IDENTITY, expected);
  });

  it("the in-sandbox extension names the same seven tools", () => {
    // The extension is bundled for the sandbox and keeps its own copy of the names; a third
    // implementation drifting would silently stop activating (and gating) a tool.
    assert.deepEqual(
      [...EXTENSION_BUILTIN_TOOL_NAMES],
      fixture.builtins.map((b) => b.name),
    );
  });

  it("key order matches the fixture order", () => {
    // `replaceActiveBuiltinTools` activates tools in this order, so the order is contractual.
    assert.deepEqual(
      Object.keys(PI_BUILTIN_TOOL_IDENTITY),
      fixture.builtins.map((b) => b.name),
    );
  });
});
