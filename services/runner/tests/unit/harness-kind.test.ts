/**
 * The one harness-identity normalizer (audit findings 3 and 6).
 *
 * Run: pnpm exec vitest run tests/unit/harness-kind.test.ts
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";

import {
  harnessKindOf,
  normalizedHarnessMode,
} from "../../src/harness-kind.ts";
import { harnessKind } from "../../src/lifecycle/reconciliation-router.ts";
import type { AgentRunRequest } from "../../src/protocol.ts";

describe("harnessKindOf", () => {
  it("round-trips every wire spelling the SDK can send", () => {
    // The SDK's HarnessKind enum plus the legacy spelling and the empty default. A value
    // added to the SDK without a row here must fail THIS test, not fall into `unknown` in
    // production the way "pi_core" once did (#6364).
    const table: Array<[string | undefined, string]> = [
      ["pi_core", "pi"],
      ["pi_agenta", "pi"], // removed experiment; old stored configs still carry it
      ["pi", "pi"], // never on the wire, accepted defensively
      ["claude", "claude"],
      ["codex", "codex"],
      ["", "pi"], // empty defaults to pi_core
      [undefined, "pi"],
      ["future-thing", "unknown"], // fail closed
      // An unchecked `JSON.parse` can put a non-string here; each must fail closed rather
      // than borrow Pi's default through a falsy `||` (#6364's review guard).
      [null as never, "unknown"],
      [0 as never, "unknown"],
      [false as never, "unknown"],
    ];
    for (const [wire, kind] of table) {
      assert.equal(harnessKindOf(wire), kind, `harnessKindOf(${wire})`);
    }
  });

  it("is the same answer the lifecycle router gives", () => {
    for (const harness of ["pi_core", "pi_agenta", "claude", "codex", "x"]) {
      assert.equal(
        harnessKind({ harness } as AgentRunRequest),
        harnessKindOf(harness),
        harness,
      );
    }
  });
});

describe("normalizedHarnessMode", () => {
  it("resolves only for codex, where the default and an absent value are equal", () => {
    assert.equal(
      normalizedHarnessMode("codex", undefined),
      "agent-full-access",
    );
    assert.equal(
      normalizedHarnessMode("codex", "agent-full-access"),
      "agent-full-access",
      "an explicitly-sent default equals an absent field",
    );
    assert.equal(normalizedHarnessMode("codex", "read-only"), "read-only");
    assert.equal(
      normalizedHarnessMode("codex", "not-a-mode"),
      "agent-full-access",
    );
    // Every non-codex harness ignores the field entirely.
    assert.equal(normalizedHarnessMode("pi_core", "read-only"), null);
    assert.equal(normalizedHarnessMode("claude", "read-only"), null);
  });
});
