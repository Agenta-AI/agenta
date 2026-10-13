import assert from "node:assert/strict";
import { describe, it } from "vitest";

import {
  commandSandboxDisposition,
  PARK_CLEAN_RESUMABLE_TURNS,
  teardownDisposition,
  type TeardownReason,
} from "../../src/engines/sandbox_agent/teardown.ts";

describe("sandbox teardown disposition", () => {
  it("maps every teardown reason with clean parking enabled", () => {
    const expected = new Map<TeardownReason, "delete" | "stop">([
      ["kill", "delete"],
      ["failed-turn", "delete"],
      ["aborted", "delete"],
      // A settled user Stop keeps the sandbox; an unsettled one stays "aborted".
      ["cancelled", "stop"],
      ["compatibility-mismatch", "delete"],
      // Lifecycle migration, step 1: the four named layers. Only the two whose daemon is sound
      // may park. See `teardown.ts`.
      ["session-incompatible", "stop"],
      ["continuity-invalid", "stop"],
      ["runtime-incompatible", "delete"],
      ["sandbox-incompatible", "delete"],
      ["clean-resumable", "stop"],
      ["idle-expiry", "stop"],
      ["capacity-eviction", "stop"],
      ["shutdown-in-flight", "delete"],
      // No other process reconnects to a sandbox this one created, so shutdown deletes idle too.
      ["shutdown-idle", "delete"],
    ]);

    assert.equal(PARK_CLEAN_RESUMABLE_TURNS, true);
    for (const [reason, disposition] of expected) {
      assert.equal(teardownDisposition(reason), disposition, reason);
    }
  });

  it("keeps the explicit false override", () => {
    assert.equal(teardownDisposition("clean-resumable", false), "delete");
    assert.equal(teardownDisposition("shutdown-idle", false), "delete");
    assert.equal(teardownDisposition("failed-turn", false), "delete");
    assert.equal(teardownDisposition("idle-expiry", false), "delete");
    assert.equal(teardownDisposition("capacity-eviction", false), "delete");
  });
});

describe("command sandbox disposition (harness in the runner)", () => {
  it("keeps the sandbox on every turn ending, and deletes it on a kill or a shutdown", () => {
    for (const reason of ["failed-turn", "aborted", "clean-resumable", "idle-expiry", undefined] as const) {
      assert.equal(commandSandboxDisposition(reason), "stop", String(reason));
    }
    for (const reason of ["kill", "shutdown-idle", "shutdown-in-flight"] as const) {
      assert.equal(commandSandboxDisposition(reason), "delete", reason);
    }
  });
});
