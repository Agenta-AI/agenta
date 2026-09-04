import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";

import {
  claimContinuationAdmission,
  resetContinuationAdmissionsForTest,
} from "../../src/sessions/continuation-admission.ts";

afterEach(resetContinuationAdmissionsForTest);

describe("durable continuation admission", () => {
  it("allows one leader and makes a concurrent duplicate wait for its durable outcome", async () => {
    const leader = claimContinuationAdmission("command-1", "turn-1", 1);
    assert.equal(leader.role, "leader");

    const duplicate = claimContinuationAdmission("command-1", "turn-1", 2);
    assert.equal(duplicate.role, "duplicate");
    let duplicateSettled = false;
    void duplicate.admitted.then(() => {
      duplicateSettled = true;
    });
    await Promise.resolve();
    assert.equal(duplicateSettled, false);

    leader.admit();
    assert.equal(await duplicate.admitted, true);
  });

  it("makes a failure before durable admission retryable", async () => {
    const first = claimContinuationAdmission("command-1", "turn-1", 1);
    assert.equal(first.role, "leader");
    const waiting = claimContinuationAdmission("command-1", "turn-1", 2);
    assert.equal(waiting.role, "duplicate");

    first.release();
    assert.equal(await waiting.admitted, false);

    const retry = claimContinuationAdmission("command-1", "turn-1", 3);
    assert.equal(retry.role, "leader");
  });

  it("pins duplicate reports to the first delivery's execution id", async () => {
    const leader = claimContinuationAdmission("command-1", "turn-original", 1);
    assert.equal(leader.role, "leader");
    leader.admit();

    const duplicate = claimContinuationAdmission(
      "command-1",
      "turn-conflicting",
      2,
    );
    assert.equal(duplicate.role, "duplicate");
    assert.equal(duplicate.executionId, "turn-original");
    assert.equal(await duplicate.admitted, true);
  });

  it("requires a fresh API admission decision after the applied cache expires", () => {
    const first = claimContinuationAdmission("command-1", "turn-1", 1);
    assert.equal(first.role, "leader");
    first.admit();

    const cached = claimContinuationAdmission("command-1", "turn-1", 2);
    assert.equal(cached.role, "duplicate");

    const afterTtl = claimContinuationAdmission(
      "command-1",
      "turn-1",
      30 * 60 * 1000 + 1,
    );
    assert.equal(afterTtl.role, "leader");
  });
});
