/**
 * Characterization of the Stop-keeps-warm path.
 *
 * A user Stop must keep the sandbox and the harness session so the next message resumes warm.
 * Three rules make that safe, and this file pins all three:
 *
 *  1. The runner asks the HARNESS to stop and waits for it to confirm (`cancelHarnessTurn`).
 *  2. Only a CONFIRMED stop parks (`shouldPark`); an unconfirmed one still destroys.
 *  3. The parked reason is on the teardown allowlist, so the sandbox is stopped, not deleted.
 */
import assert from "node:assert/strict";
import { describe, it } from "vitest";

import {
  cancelHarnessTurn,
  DEFAULT_CANCEL_SETTLE_MS,
} from "../../src/engines/sandbox_agent/cancel-turn.ts";
import { shouldPark } from "../../src/engines/sandbox_agent/engine.ts";
import { readKeepaliveConfig } from "../../src/engines/sandbox_agent/session-identity.ts";
import {
  isUserStopAbort,
  USER_STOP_ABORT_REASON,
} from "../../src/sessions/stop-signal.ts";
import { teardownDisposition } from "../../src/engines/sandbox_agent/teardown.ts";
import type { AgentRunResult } from "../../src/protocol.ts";

const cancelledTurn = (cancelSettled: boolean): AgentRunResult => ({
  ok: true,
  output: "partial answer",
  stopReason: "cancelled",
  cancelSettled,
});

/** An abort that is NOT a user Stop: a disconnect, a future call site, anything unlabelled. */
const abortedSignal = (): AbortSignal => {
  const controller = new AbortController();
  controller.abort();
  return controller.signal;
};

/** The cooperative user Stop: the heartbeat interrupt labels its abort. */
const userStopSignal = (): AbortSignal => {
  const controller = new AbortController();
  controller.abort(USER_STOP_ABORT_REASON);
  return controller.signal;
};

const never = (): Promise<never> => new Promise<never>(() => {});
const noLog = (): void => {};

describe("cancelHarnessTurn", () => {
  it("sends the cancel and reports settled when the harness answers the prompt", async () => {
    const cancelled: string[] = [];
    const result = await cancelHarnessTurn({
      sandbox: {
        cancelSession: async (id: string) => {
          cancelled.push(id);
        },
      },
      sessionId: "sess-1",
      promptPromise: Promise.resolve({ stopReason: "cancelled" }),
      timeoutMs: 5_000,
      wait: never,
      log: noLog,
    });

    assert.deepEqual(cancelled, ["sess-1"]);
    assert.equal(result.requested, true);
    assert.equal(result.settled, true);
  });

  it("reports unsettled when the harness never answers inside the budget", async () => {
    const result = await cancelHarnessTurn({
      sandbox: { cancelSession: async () => {} },
      sessionId: "sess-1",
      promptPromise: never(),
      timeoutMs: 5_000,
      wait: async () => {},
      log: noLog,
    });

    assert.equal(result.requested, true);
    assert.equal(result.settled, false);
  });

  it("reports unsettled when the prompt rejects instead of answering", async () => {
    const result = await cancelHarnessTurn({
      sandbox: { cancelSession: async () => {} },
      sessionId: "sess-1",
      promptPromise: Promise.reject(new Error("transport closed")),
      timeoutMs: 5_000,
      wait: never,
      log: noLog,
    });

    assert.equal(result.requested, true);
    assert.equal(result.settled, false);
  });

  it("reports neither requested nor settled on an unpatched client", async () => {
    const result = await cancelHarnessTurn({
      sandbox: {},
      sessionId: "sess-1",
      promptPromise: never(),
      timeoutMs: 5_000,
      wait: never,
      log: noLog,
    });

    assert.equal(result.requested, false);
    assert.equal(result.settled, false);
  });

  it("reports unsettled when the cancel itself throws", async () => {
    const result = await cancelHarnessTurn({
      sandbox: {
        cancelSession: async () => {
          throw new Error("daemon gone");
        },
      },
      sessionId: "sess-1",
      promptPromise: never(),
      timeoutMs: 5_000,
      wait: never,
      log: noLog,
    });

    assert.equal(result.requested, false);
    assert.equal(result.settled, false);
  });

  it("keeps a settle budget a user would wait through", () => {
    assert.ok(DEFAULT_CANCEL_SETTLE_MS > 0);
    assert.ok(DEFAULT_CANCEL_SETTLE_MS <= 30_000);
  });
});

describe("the user-Stop abort label", () => {
  it("recognizes only the abort that carries the Stop reason", () => {
    assert.equal(isUserStopAbort(userStopSignal()), true);
    assert.equal(isUserStopAbort(abortedSignal()), false);
    assert.equal(isUserStopAbort(undefined), false);
    assert.equal(isUserStopAbort(new AbortController().signal), false);
  });

  it("cannot be forged by a look-alike value", () => {
    const controller = new AbortController();
    controller.abort({ agentaAbort: "user-stop" });
    assert.equal(isUserStopAbort(controller.signal), false);
  });
});

describe("shouldPark on a user Stop", () => {
  it("parks a stopped turn whose harness cancel settled", () => {
    assert.equal(
      shouldPark(cancelledTurn(true), userStopSignal(), undefined),
      true,
    );
  });

  it("destroys a stopped turn whose harness cancel timed out", () => {
    assert.equal(
      shouldPark(cancelledTurn(false), userStopSignal(), undefined),
      false,
    );
  });

  it("destroys an UNLABELLED abort even when the cancel settled", () => {
    // The guard that keeps a future `controller.abort()` from silently parking a sandbox
    // nobody checked. Only the heartbeat interrupt labels its abort.
    assert.equal(
      shouldPark(cancelledTurn(true), abortedSignal(), undefined),
      false,
    );
  });

  it("destroys an aborted turn that never reported a cancel at all", () => {
    const runLimitTrip: AgentRunResult = { ok: false, error: "run limit" };
    assert.equal(shouldPark(runLimitTrip, userStopSignal(), undefined), false);
  });

  it("keeps destroying on client disconnect, settled cancel or not", () => {
    assert.equal(
      shouldPark(cancelledTurn(true), userStopSignal(), () => true),
      false,
    );
    assert.equal(
      shouldPark({ ok: true, stopReason: "end_turn" }, undefined, () => true),
      false,
    );
  });

  it("leaves every non-abort verdict as it was", () => {
    assert.equal(
      shouldPark({ ok: true, stopReason: "end_turn" }, undefined, undefined),
      true,
    );
    assert.equal(
      shouldPark({ ok: false, error: "boom" }, undefined, undefined),
      false,
    );
    assert.equal(
      shouldPark({ ok: true, stopReason: "paused" }, undefined, undefined),
      false,
    );
  });
});

describe("the cancelled teardown reason", () => {
  it("stops the sandbox instead of deleting it", () => {
    assert.equal(teardownDisposition("cancelled"), "stop");
  });

  it("still deletes when clean parking is switched off", () => {
    assert.equal(teardownDisposition("cancelled", false), "delete");
  });

  it("leaves a plain abort deleting", () => {
    assert.equal(teardownDisposition("aborted"), "delete");
  });
});

describe("the stopped-session park window", () => {
  it("gives a local stopped session the longer approval window, not the idle one", () => {
    const config = readKeepaliveConfig("local");
    assert.equal(config.ttlMs, 60_000);
    assert.equal(config.approvalTtlMs, 600_000);
    assert.equal(config.stoppedTtlMs, 600_000);
  });

  it("keeps a Daytona stopped session on its billed idle window by default", () => {
    const config = readKeepaliveConfig("daytona");
    assert.equal(config.ttlMs, 120_000);
    assert.equal(config.stoppedTtlMs, 120_000);
  });
});
