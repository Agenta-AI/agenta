import assert from "node:assert/strict";
import { describe, it } from "vitest";

import {
  PARK_CLEAN_RESUMABLE_TURNS,
  teardownDisposition,
  type TeardownReason,
} from "../../src/engines/sandbox_agent/teardown.ts";

describe("sandbox teardown disposition", () => {
  it("maps every teardown reason while parking is inert", () => {
    const expected = new Map<TeardownReason, "delete">([
      ["kill", "delete"],
      ["failed-turn", "delete"],
      ["aborted", "delete"],
      ["compatibility-mismatch", "delete"],
      ["clean-resumable", "delete"],
      ["shutdown-in-flight", "delete"],
      ["shutdown-idle", "delete"],
    ]);

    assert.equal(PARK_CLEAN_RESUMABLE_TURNS, false);
    for (const [reason, disposition] of expected) {
      assert.equal(teardownDisposition(reason), disposition, reason);
    }
  });

  it("maps clean and idle shutdown teardown to stop when parking is enabled", () => {
    assert.equal(teardownDisposition("clean-resumable", true), "stop");
    assert.equal(teardownDisposition("shutdown-idle", true), "stop");
    assert.equal(teardownDisposition("failed-turn", true), "delete");
  });
});
