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

  it("evicts a stale applied generation after the API finds no live execution", async () => {
    const first = claimContinuationAdmission("command-1", "turn-1", 1);
    assert.equal(first.role, "leader");
    first.admit();
    const stale = claimContinuationAdmission("command-1", "turn-1", 2);
    assert.equal(stale.role, "duplicate");
    stale.forget();
    assert.equal(
      claimContinuationAdmission("command-1", "turn-1", 3).role,
      "leader",
    );
  });

  it("promotes only the API-winning duplicate into a fresh generation", () => {
    const first = claimContinuationAdmission("command-1", "turn-1", 1);
    assert.equal(first.role, "leader");
    first.admit();
    const winner = claimContinuationAdmission("command-1", "turn-1", 2);
    const loser = claimContinuationAdmission("command-1", "turn-1", 2);
    assert.equal(winner.role, "duplicate");
    assert.equal(loser.role, "duplicate");
    const promoted = winner.promote();
    assert.equal(promoted?.role, "leader");
    loser.forget();
    assert.equal(
      claimContinuationAdmission("command-1", "turn-1", 3).role,
      "duplicate",
      "the prior loser cannot evict the recovered generation",
    );
  });

  it("promotes a recovered command with its fresh execution generation", () => {
    const first = claimContinuationAdmission("command-1", "turn-old", 1);
    assert.equal(first.role, "leader");
    first.admit();

    const recovered = claimContinuationAdmission("command-1", "turn-fresh", 2);
    assert.equal(recovered.role, "duplicate");
    assert.equal(recovered.executionId, "turn-old");

    const promoted = recovered.promote();
    assert.equal(promoted?.executionId, "turn-fresh");
    const waiter = claimContinuationAdmission("command-1", "turn-fresh", 3);
    assert.equal(waiter.role, "duplicate");
    assert.equal(waiter.executionId, "turn-fresh");
  });

  it("lets the API winner recover after a losing probe evicts the stale cache", () => {
    const first = claimContinuationAdmission("command-1", "turn-1", 1);
    assert.equal(first.role, "leader");
    first.admit();
    const winner = claimContinuationAdmission("command-1", "turn-1", 2);
    const loser = claimContinuationAdmission("command-1", "turn-1", 2);
    assert.equal(winner.role, "duplicate");
    assert.equal(loser.role, "duplicate");
    loser.forget();
    assert.equal(winner.promote()?.role, "leader");
  });

  it("never overwrites a newer pending generation during promotion", async () => {
    const first = claimContinuationAdmission("command-1", "turn-1", 1);
    assert.equal(first.role, "leader");
    first.admit();
    const staleWinner = claimContinuationAdmission("command-1", "turn-1", 2);
    const staleLoser = claimContinuationAdmission("command-1", "turn-1", 2);
    assert.equal(staleWinner.role, "duplicate");
    assert.equal(staleLoser.role, "duplicate");

    staleLoser.forget();
    const freshLeader = claimContinuationAdmission("command-1", "turn-1", 3);
    const freshWaiter = claimContinuationAdmission("command-1", "turn-1", 4);
    assert.equal(freshLeader.role, "leader");
    assert.equal(freshWaiter.role, "duplicate");

    assert.equal(staleWinner.promote(), undefined);
    freshLeader.release();
    assert.equal(await freshWaiter.admitted, false);
  });
});
