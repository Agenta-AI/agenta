import assert from "node:assert/strict";
import { describe, it } from "vitest";

import {
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
      ["compatibility-mismatch", "delete"],
      ["clean-resumable", "stop"],
      ["idle-expiry", "stop"],
      ["capacity-eviction", "stop"],
      ["shutdown-in-flight", "delete"],
      ["shutdown-idle", "stop"],
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
