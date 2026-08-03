/**
 * Unit test for the runner's `/health` identity payload (`src/version.ts`).
 *
 * `HARNESS_KINDS` is a hardcoded list whose only consumer is `runnerInfo().harnesses` — nothing
 * is gated on it, but a client probing `/health` uses it to learn what the runner supports. Codex
 * became a harness of its own (its own model catalog, its own `CODEX_HOME` setup) without this
 * list being extended, so `/health` under-reported it (#5693).
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";

import { HARNESS_KINDS, runnerInfo } from "../../src/version.ts";

describe("HARNESS_KINDS", () => {
  it("lists codex alongside the other harnesses the runner drives", () => {
    assert.deepEqual(
      [...HARNESS_KINDS].sort(),
      ["claude", "codex", "pi_agenta", "pi_core"].sort(),
    );
  });
});

describe("runnerInfo", () => {
  it("surfaces codex in the /health payload's harnesses list", () => {
    assert.ok(runnerInfo().harnesses.includes("codex"));
  });
});
