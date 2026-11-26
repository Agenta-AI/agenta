/** Unit test for the runner's `/health` identity payload (`src/version.ts`). */
import { describe, it } from "vitest";
import assert from "node:assert/strict";

import { runnerInfo } from "../../src/version.ts";

describe("runnerInfo", () => {
  it("lists every harness the runner drives, including codex", () => {
    assert.deepEqual(runnerInfo().harnesses, ["pi_core", "claude", "codex"]);
  });
});
