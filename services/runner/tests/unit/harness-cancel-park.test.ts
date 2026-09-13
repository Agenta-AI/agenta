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
import { afterEach, beforeEach, describe, it } from "vitest";

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
import { createSandboxAgentOtel } from "../../src/tracing/otel.ts";
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

  it("bounds a cancel request that never answers", async () => {
    const logs: string[] = [];
    const result = await cancelHarnessTurn({
      sandbox: { cancelSession: never },
      sessionId: "sess-1",
      promptPromise: Promise.resolve({ stopReason: "cancelled" }),
      timeoutMs: 5_000,
      wait: async () => {},
      log: (message) => logs.push(message),
    });

    assert.deepEqual(result, { settled: false, requested: false, elapsedMs: 0 });
    assert.ok(logs.some((line) => line.includes("reason=request-timeout")));
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

  it("parks a settled Stop even though the client dropped its stream", () => {
    // The case the product actually produces. The browser's Stop button aborts the chat stream
    // in the same tick it sends the durable cancel command, so a real Stop ALWAYS reaches this
    // predicate with the client already gone. This assertion used to read `false`, and reading
    // the disconnect first is what deleted the sandbox on every Stop.
    assert.equal(
      shouldPark(cancelledTurn(true), userStopSignal(), () => true),
      true,
    );
  });

  it("keeps destroying on every disconnect that is not a settled Stop", () => {
    // A disconnect with no Stop behind it, an unlabelled abort, and an unconfirmed cancel all
    // leave a session nobody asked to keep. The rule the disconnect check exists for is intact.
    assert.equal(
      shouldPark({ ok: true, stopReason: "end_turn" }, undefined, () => true),
      false,
    );
    assert.equal(
      shouldPark(cancelledTurn(true), abortedSignal(), () => true),
      false,
    );
    assert.equal(
      shouldPark(cancelledTurn(false), userStopSignal(), () => true),
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
  const ttlEnvNames = [
    "AGENTA_RUNNER_SESSION_TTL_MS",
    "AGENTA_RUNNER_SESSION_APPROVAL_TTL_MS",
    "AGENTA_RUNNER_SESSION_STOPPED_TTL_MS",
    "AGENTA_RUNNER_DAYTONA_SESSION_IDLE_TTL_MS",
  ] as const;
  let savedTtlEnv: Record<string, string | undefined>;

  beforeEach(() => {
    savedTtlEnv = Object.fromEntries(
      ttlEnvNames.map((name) => [name, process.env[name]]),
    );
    for (const name of ttlEnvNames) delete process.env[name];
  });

  afterEach(() => {
    for (const name of ttlEnvNames) {
      const value = savedTtlEnv[name];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  // A settled Stop gets the same ten-minute human-response window on both providers. The
  // ordinary idle windows remain shorter and continue to govern clean completed turns.
  it("defaults a local stopped session to the approval window", () => {
    const config = readKeepaliveConfig("local");
    assert.equal(config.ttlMs, 60_000);
    assert.equal(config.stoppedTtlMs, 600_000);
    assert.equal(config.approvalTtlMs, 600_000);
  });

  it("defaults a Daytona stopped session to the ten-minute human-response window", () => {
    const config = readKeepaliveConfig("daytona");
    assert.equal(config.ttlMs, 120_000);
    assert.equal(config.stoppedTtlMs, 600_000);
  });

  it("moves with its own env var, without touching the ordinary idle window", () => {
    process.env.AGENTA_RUNNER_SESSION_STOPPED_TTL_MS = "300000";
    const local = readKeepaliveConfig("local");
    const daytona = readKeepaliveConfig("daytona");
    assert.equal(local.stoppedTtlMs, 300_000);
    assert.equal(local.ttlMs, 60_000);
    assert.equal(daytona.stoppedTtlMs, 300_000);
    assert.equal(daytona.ttlMs, 120_000);
  });
});

describe("the terminal done record", () => {
  /** Finish a runner-traced turn and hand back the terminal `done` event it recorded. */
  const doneRecordFor = (stopReason?: string): Record<string, unknown> => {
    const run = createSandboxAgentOtel({
      harness: "pi",
      model: "openai/x",
      emitSpans: false,
    });
    run.start({ prompt: "hi" });
    run.finish(stopReason);
    const done = run.events().find((event) => event.type === "done");
    assert.ok(done, "the turn must record exactly one terminal done event");
    return done as unknown as Record<string, unknown>;
  };

  it("carries the stop reason for a user Stop", () => {
    // Without this, a stopped turn is indistinguishable from a completed one in Postgres, so
    // neither the frontend nor the release gate can tell a Stop from a finish.
    assert.equal(doneRecordFor("cancelled").stopReason, "cancelled");
  });

  it("still carries a pause, which is what this field originally existed for", () => {
    assert.equal(doneRecordFor("paused").stopReason, "paused");
  });

  it("carries an error so a failed turn cannot settle as a normal completion", () => {
    assert.equal(doneRecordFor("error").stopReason, "error");
  });

  it("omits the field for a completed turn and for every harness-reported reason", () => {
    // An explicit allowlist, so `end_turn` / `max_tokens` / a future harness string
    // cannot start appearing on the terminal record by accident.
    assert.equal(doneRecordFor("end_turn").stopReason, undefined);
    assert.equal(doneRecordFor("max_tokens").stopReason, undefined);
    assert.equal(doneRecordFor(undefined).stopReason, undefined);
  });
});
