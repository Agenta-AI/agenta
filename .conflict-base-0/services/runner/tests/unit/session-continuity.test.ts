/**
 * Unit tests for the in-memory continuity store (`engines/sandbox_agent/session-continuity.ts`).
 *
 * Pure map + policy logic, no sandbox-agent imports: exercised directly against
 * `SessionContinuityStore` instances (never the process-wide singleton, to keep tests
 * isolated). Covers record/read-back, the per-harness staleness guard including the
 * double-switch scenario, and the local-runner ownership guard.
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";

import {
  SessionContinuityStore,
  nextTurnIndex,
  isHarnessLoadEligible,
  eligibleAgentSessionId,
  isLocalRunnerEligible,
  assertLocalRunnerOwnership,
  LocalSandboxNotOwnerError,
} from "../../src/engines/sandbox_agent/session-continuity.ts";

describe("SessionContinuityStore basics", () => {
  it("get/latestTurn are empty for an unknown session", () => {
    const store = new SessionContinuityStore();
    assert.equal(store.get("sess-1", "claude"), undefined);
    assert.equal(store.latestTurn("sess-1"), -1);
    assert.equal(store.size(), 0);
  });

  it("record sets the per-harness record and bumps latestTurn", () => {
    const store = new SessionContinuityStore();
    store.record("sess-1", "claude", "agent-abc", 0);
    assert.deepEqual(store.get("sess-1", "claude"), {
      agentSessionId: "agent-abc",
      turnIndex: 0,
    });
    assert.equal(store.latestTurn("sess-1"), 0);
  });

  it("latestTurn never regresses when an OLDER turn is recorded again", () => {
    const store = new SessionContinuityStore();
    store.record("sess-1", "claude", "agent-1", 3);
    store.record("sess-1", "pi", "agent-2", 1);
    assert.equal(store.latestTurn("sess-1"), 3, "latest stays at the higher turn index");
    assert.deepEqual(store.get("sess-1", "pi"), {
      agentSessionId: "agent-2",
      turnIndex: 1,
    });
  });

  it("clear drops every record for a session but leaves other sessions untouched", () => {
    const store = new SessionContinuityStore();
    store.record("sess-1", "claude", "agent-1", 0);
    store.record("sess-2", "claude", "agent-2", 0);
    store.clear("sess-1");
    assert.equal(store.get("sess-1", "claude"), undefined);
    assert.equal(store.latestTurn("sess-1"), -1);
    assert.deepEqual(store.get("sess-2", "claude"), {
      agentSessionId: "agent-2",
      turnIndex: 0,
    });
    assert.equal(store.size(), 1);
  });

  it("size counts total (session, harness) records across sessions", () => {
    const store = new SessionContinuityStore();
    store.record("sess-1", "claude", "a1", 0);
    store.record("sess-1", "pi", "a2", 1);
    store.record("sess-2", "claude", "a3", 0);
    assert.equal(store.size(), 3);
  });
});

describe("nextTurnIndex", () => {
  it("is 0 for a session with no recorded turn yet", () => {
    const store = new SessionContinuityStore();
    assert.equal(nextTurnIndex("sess-1", store), 0);
  });

  it("is one past the latest recorded turn", () => {
    const store = new SessionContinuityStore();
    store.record("sess-1", "claude", "a1", 0);
    assert.equal(nextTurnIndex("sess-1", store), 1);
    store.record("sess-1", "pi", "a2", 1);
    assert.equal(nextTurnIndex("sess-1", store), 2);
  });
});

// --- record / read-back --- //

describe("record/read-back", () => {
  it("an id recorded at turn N is eligible and readable at N+1 for the SAME harness", () => {
    const store = new SessionContinuityStore();
    store.record("sess-1", "claude", "agent-N", 0);
    assert.equal(isHarnessLoadEligible("sess-1", "claude", store), true);
    assert.equal(eligibleAgentSessionId("sess-1", "claude", store), "agent-N");
  });

  it("a different harness key at the same turn is undefined (no cross-harness leak)", () => {
    const store = new SessionContinuityStore();
    store.record("sess-1", "claude", "agent-N", 0);
    assert.equal(isHarnessLoadEligible("sess-1", "pi", store), false);
    assert.equal(eligibleAgentSessionId("sess-1", "pi", store), undefined);
  });

  it("an empty store: eligibleAgentSessionId is undefined (cold path taken)", () => {
    const store = new SessionContinuityStore();
    assert.equal(isHarnessLoadEligible("sess-new", "claude", store), false);
    assert.equal(eligibleAgentSessionId("sess-new", "claude", store), undefined);
  });
});

// --- the double-switch staleness guard (highest-value test) --- //

describe("per-harness staleness guard", () => {
  it("Claude(turn0) -> pi(turn1) -> claude(turn2): claude is stale after the hop, then reloads on turn3 after a fresh cold write", () => {
    const store = new SessionContinuityStore();

    // Turn 0: claude runs and records its session.
    store.record("sess-1", "claude", "claude-session-0", 0);
    assert.equal(
      isHarnessLoadEligible("sess-1", "claude", store),
      true,
      "claude is eligible immediately after its own turn",
    );

    // Turn 1: pi runs (a harness switch). pi records its own session at turn 1.
    store.record("sess-1", "pi", "pi-session-1", 1);
    assert.equal(store.latestTurn("sess-1"), 1);

    // claude's turn-0 record is now stale: turnIndex(0) != latestTurn(1).
    assert.equal(
      isHarnessLoadEligible("sess-1", "claude", store),
      false,
      "claude's file is stale after pi ran turn 1",
    );
    assert.equal(
      eligibleAgentSessionId("sess-1", "claude", store),
      undefined,
      "a stale harness must not hand back a loadable id -- cold text replay instead",
    );
    // pi, having authored the latest turn, IS eligible.
    assert.equal(isHarnessLoadEligible("sess-1", "pi", store), true);

    // Turn 2: claude hops back and, because it was stale, cold-replays -- meaning it does NOT
    // call session/load and instead writes a FRESH session record for turn 2.
    const nextTurn = nextTurnIndex("sess-1", store);
    assert.equal(nextTurn, 2);
    store.record("sess-1", "claude", "claude-session-2", nextTurn);

    // Claude is eligible again immediately after its own fresh turn.
    assert.equal(isHarnessLoadEligible("sess-1", "claude", store), true);
    assert.equal(
      eligibleAgentSessionId("sess-1", "claude", store),
      "claude-session-2",
      "the fresh turn-2 write, not the stale turn-0 one, is what a consecutive claude turn loads",
    );

    // pi is now the stale one (a switch dirties every harness except the one now
    // running").
    assert.equal(isHarnessLoadEligible("sess-1", "pi", store), false);
  });

  it("a consecutive same-harness run stays eligible turn after turn", () => {
    const store = new SessionContinuityStore();
    store.record("sess-1", "claude", "c0", 0);
    assert.equal(isHarnessLoadEligible("sess-1", "claude", store), true);
    store.record("sess-1", "claude", "c1", nextTurnIndex("sess-1", store));
    assert.equal(isHarnessLoadEligible("sess-1", "claude", store), true);
    assert.equal(eligibleAgentSessionId("sess-1", "claude", store), "c1");
  });

  it("three-way hop Claude -> codex -> pi-claude -> Claude: the final claude turn is stale until it writes fresh", () => {
    const store = new SessionContinuityStore();
    store.record("sess-1", "claude", "c0", 0);
    store.record("sess-1", "codex", "x1", 1);
    store.record("sess-1", "pi-claude", "p2", 2);

    assert.equal(
      isHarnessLoadEligible("sess-1", "claude", store),
      false,
      "claude's file is two turns stale (codex then pi-claude ran since)",
    );
    assert.equal(eligibleAgentSessionId("sess-1", "claude", store), undefined);
  });
});

// --- local multi-runner fails loudly --- //

describe("isLocalRunnerEligible", () => {
  it("is eligible when no owner is known yet (nothing to conflict with)", () => {
    assert.equal(isLocalRunnerEligible(undefined, "replica-a"), true);
  });

  it("is eligible when the owner IS this replica", () => {
    assert.equal(isLocalRunnerEligible("replica-a", "replica-a"), true);
  });

  it("is NOT eligible when a known owner is a DIFFERENT replica", () => {
    assert.equal(isLocalRunnerEligible("replica-a", "replica-b"), false);
  });
});

describe("assertLocalRunnerOwnership", () => {
  it("is a no-op (never throws) when the owner is undefined", () => {
    assert.doesNotThrow(() =>
      assertLocalRunnerOwnership("sess-1", "replica-a", undefined),
    );
  });

  it("is a no-op when the owner equals the caller's replica id", () => {
    assert.doesNotThrow(() =>
      assertLocalRunnerOwnership("sess-1", "replica-a", "replica-a"),
    );
  });

  it("throws LocalSandboxNotOwnerError with the right fields when a KNOWN owner disagrees", () => {
    assert.throws(
      () => assertLocalRunnerOwnership("sess-1", "replica-b", "replica-a"),
      (err: unknown) => {
        assert.ok(err instanceof LocalSandboxNotOwnerError);
        assert.equal(err.sessionId, "sess-1");
        assert.equal(err.replicaId, "replica-b");
        assert.equal(err.ownerReplicaId, "replica-a");
        assert.match(err.message, /local sandbox requires a single runner/);
        return true;
      },
    );
  });
});
