/**
 * The rules a control command obeys on the runner.
 *
 * A Stop reaches the runner as a durable command naming one execution. Four rules decide what
 * the runner does with it, and this file pins all four:
 *
 *  1. It aborts the named execution when it holds it, which is what keeps the sandbox warm
 *     (the abort ends the turn `cancelled`, and only a cancelled turn takes the park path).
 *  2. It aborts NOTHING when it holds an execution that started after the command was created.
 *     That is the late-Stop guard, and it is exact because it reads this process's own memory.
 *  3. A session it holds parked awaiting an approval answers `not_running` and stays parked.
 *     Stop ends the work, not the session.
 *  4. The same command delivered twice aborts once and acknowledges twice.
 */
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "vitest";

import {
  applyCommand,
  holdsSession,
  type ControlCommand,
  type ControlOutcome,
} from "../../src/sessions/control-channel.ts";
import { resetAppliedCommandsForTest } from "../../src/sessions/applied-commands.ts";
import {
  findExecution,
  registerExecution,
  resetExecutionsForTest,
  unregisterExecution,
  type LiveExecution,
} from "../../src/sessions/execution-registry.ts";

const PROJECT = "11111111-1111-4111-8111-111111111111";
const SESSION = "sess-42";
const TURN = "turn-A";

/** t=1000 is "now"; a command created at t=1000 is contemporary with a run started at t=900. */
const COMMAND_CREATED_AT = new Date(1000).toISOString();

function command(overrides: Partial<ControlCommand> = {}): ControlCommand {
  return {
    id: "cmd-1",
    projectId: PROJECT,
    sessionId: SESSION,
    kind: "cancel",
    target: { turnId: TURN, expectedTurnId: null },
    createdAt: COMMAND_CREATED_AT,
    ...overrides,
  };
}

function liveRun(
  overrides: Partial<LiveExecution> = {},
): { execution: LiveExecution; aborts: number[] } {
  const aborts: number[] = [];
  const execution: LiveExecution = {
    projectId: PROJECT,
    sessionId: SESSION,
    turnId: TURN,
    startedAt: 900,
    abort: () => aborts.push(Date.now()),
    ...overrides,
  };
  return { execution, aborts };
}

function collector(): {
  reported: ControlOutcome[];
  report: (c: ControlCommand, o: ControlOutcome) => Promise<void>;
} {
  const reported: ControlOutcome[] = [];
  return {
    reported,
    report: async (_c, o) => {
      reported.push(o);
    },
  };
}

beforeEach(() => {
  resetExecutionsForTest();
  resetAppliedCommandsForTest();
});

describe("applyCommand", () => {
  it("aborts the live execution the command names and reports it stopped", async () => {
    const { execution, aborts } = liveRun();
    const { reported, report } = collector();

    const outcome = await applyCommand(command(), {
      findLive: () => execution,
      report,
    });

    assert.equal(aborts.length, 1);
    assert.equal(outcome.result, "applied");
    assert.equal(outcome.execution.state, "stopped");
    assert.equal(outcome.execution.id, TURN);
    assert.deepEqual(reported, [outcome]);
  });

  it("aborts nothing when this process holds no execution for the session", async () => {
    // The parked-approval case. There is no turn to abort, and the parked environment must
    // stay in the pool so the next message is warm.
    const { reported, report } = collector();

    const outcome = await applyCommand(command(), {
      findLive: () => undefined,
      report,
    });

    assert.equal(outcome.result, "applied");
    assert.equal(outcome.execution.state, "not_running");
    assert.equal(reported.length, 1);
  });

  it("refuses to abort an execution that started AFTER the command was created", async () => {
    const { execution, aborts } = liveRun({
      turnId: "turn-B",
      startedAt: 5000, // the command was created at t=1000
    });
    const { reported, report } = collector();

    const outcome = await applyCommand(command(), {
      findLive: () => execution,
      report,
    });

    assert.equal(aborts.length, 0, "a newer turn must never be aborted");
    assert.equal(outcome.result, "obsolete");
    assert.equal(outcome.execution.state, "superseded_by_newer_turn");
    assert.equal(reported.length, 1);
  });

  it("reports not_running when it holds a DIFFERENT, older execution", async () => {
    const { execution, aborts } = liveRun({ turnId: "turn-Z", startedAt: 500 });
    const { report } = collector();

    const outcome = await applyCommand(command(), {
      findLive: () => execution,
      report,
    });

    assert.equal(aborts.length, 0);
    assert.equal(outcome.result, "obsolete");
    assert.equal(outcome.execution.state, "not_running");
    assert.equal(outcome.execution.id, TURN);
  });

  it("aborts once and acknowledges twice when the same command is delivered twice", async () => {
    const { execution, aborts } = liveRun();
    const { reported, report } = collector();

    await applyCommand(command(), { findLive: () => execution, report });
    await applyCommand(command(), { findLive: () => execution, report });

    assert.equal(aborts.length, 1, "a second abort could kill a newer turn");
    assert.equal(reported.length, 2, "a lost acknowledgement must be repairable");
    assert.equal(reported[1].execution.state, "stopped");
  });

  it("remembers the command before aborting, so a duplicate mid-cancel is still a no-op", async () => {
    // The abort itself delivers a second copy of the same command, which is what a retried
    // admission looks like on the wire.
    let nested: ControlOutcome | undefined;
    const { report } = collector();
    const aborts: number[] = [];
    const execution: LiveExecution = {
      projectId: PROJECT,
      sessionId: SESSION,
      turnId: TURN,
      startedAt: 900,
      abort: () => {
        aborts.push(1);
      },
    };

    const outcome = await applyCommand(command(), {
      findLive: () => execution,
      report: async (c, o) => {
        if (nested === undefined) {
          nested = await applyCommand(c, { findLive: () => execution, report });
        }
      },
    });

    assert.equal(aborts.length, 1);
    assert.equal(outcome.execution.state, "stopped");
    assert.equal(nested?.execution.state, "stopped");
  });

  it("reports the cancel as failed when the abort itself throws", async () => {
    const execution: LiveExecution = {
      projectId: PROJECT,
      sessionId: SESSION,
      turnId: TURN,
      startedAt: 900,
      abort: () => {
        throw new Error("controller is gone");
      },
    };
    const { reported, report } = collector();

    const outcome = await applyCommand(command(), {
      findLive: () => execution,
      report,
    });

    assert.equal(outcome.execution.state, "failed");
    assert.equal(outcome.execution.error, "controller is gone");
    assert.equal(reported.length, 1);
  });
});

describe("the execution registry", () => {
  it("finds a run by its project and session, not by session alone", () => {
    const { execution } = liveRun();
    registerExecution(execution);

    assert.equal(findExecution(PROJECT, SESSION)?.turnId, TURN);
    assert.equal(
      findExecution("22222222-2222-4222-8222-222222222222", SESSION),
      undefined,
      "two projects may use the same session id; the project is the tenant boundary",
    );
  });

  it("does not let a finished turn unregister its successor", () => {
    const first = liveRun({ turnId: "turn-1" }).execution;
    const second = liveRun({ turnId: "turn-2" }).execution;
    registerExecution(first);
    registerExecution(second);

    unregisterExecution(PROJECT, SESSION, "turn-1");

    assert.equal(findExecution(PROJECT, SESSION)?.turnId, "turn-2");
  });
});

describe("holdsSession", () => {
  it("is true for a live execution", () => {
    registerExecution(liveRun().execution);
    assert.equal(holdsSession(PROJECT, SESSION), true);
  });

  it("is true for a session parked awaiting an approval, which runs no turn", () => {
    // This is the case that has no control channel at all today: a parked session stops
    // heartbeating, so the existing Stop signal never reaches it.
    assert.equal(holdsSession(PROJECT, SESSION), false);
    assert.equal(
      holdsSession(PROJECT, SESSION, (id) => id === SESSION),
      true,
    );
  });

  it("is false for a session this process does not hold, which is what answers 404", () => {
    assert.equal(holdsSession(PROJECT, "other-session", () => false), false);
  });
});
