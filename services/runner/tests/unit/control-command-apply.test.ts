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
 *  3. A session it holds parked awaiting an approval releases every gate, answers `stopped`,
 *     and stays warm as an idle session for the next normal prompt.
 *  4. The same command delivered twice aborts once and acknowledges twice.
 *  5. It aborts NOTHING when the named execution's prompt has already settled and only its
 *     teardown is still running. That Stop lost the race by a moment, and aborting a finished
 *     run would destroy the warm environment teardown was about to park.
 */
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "vitest";

import {
  applyCommand,
  holdsSession,
  reportOutcome,
  type ControlCommand,
  type ControlOutcome,
} from "../../src/sessions/control-channel.ts";
import { stopParkedApprovalSession } from "../../src/server.ts";
import { resetAppliedCommandsForTest } from "../../src/sessions/applied-commands.ts";
import { shouldPark } from "../../src/engines/sandbox_agent/engine.ts";
import type {
  ParkedApproval,
  SessionEnvironment,
} from "../../src/engines/sandbox_agent.ts";
import {
  isUserStopAbort,
  USER_STOP_ABORT_REASON,
} from "../../src/sessions/stop-signal.ts";
import {
  findExecution,
  noteExecutionSettled,
  registerExecution,
  resetExecutionsForTest,
  noteExecutionProject,
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

  it("reports not_running when this process holds no execution or parked approval", async () => {
    const { reported, report } = collector();

    const outcome = await applyCommand(command(), {
      findLive: () => undefined,
      report,
    });

    assert.equal(outcome.result, "applied");
    assert.equal(outcome.execution.state, "not_running");
    assert.equal(reported.length, 1);
  });

  it("stops a parked approval, clears its gates, and leaves the next prompt warm", async () => {
    const { reported, report } = collector();
    const permissionReplies: Array<{ id: string; reply: string }> = [];
    const prompts: string[] = [];
    const parked = {
      state: "awaiting_approval" as "awaiting_approval" | "idle",
      gates: new Map([
        ["tool-a", { permissionId: "perm-a" }],
        ["tool-b", { permissionId: "perm-b" }],
      ]),
      session: {
        respondPermission: async (id: string, reply: string) => {
          permissionReplies.push({ id, reply });
        },
        prompt: async (text: string) => {
          prompts.push(text);
        },
      },
    };

    const outcome = await applyCommand(command(), {
      findLive: () => undefined,
      isParked: (projectId, sessionId) =>
        projectId === PROJECT &&
        sessionId === SESSION &&
        parked.state === "awaiting_approval"
          ? {
              stop: async () => {
                for (const gate of parked.gates.values()) {
                  await parked.session.respondPermission(
                    gate.permissionId,
                    "reject",
                  );
                }
                parked.gates.clear();
                parked.state = "idle";
              },
            }
          : undefined,
      report,
    });

    assert.equal(outcome.result, "applied");
    assert.equal(outcome.execution.state, "stopped");
    assert.equal(outcome.execution.id, TURN);
    assert.deepEqual(permissionReplies, [
      { id: "perm-a", reply: "reject" },
      { id: "perm-b", reply: "reject" },
    ]);
    assert.equal(parked.gates.size, 0);
    assert.equal(parked.state, "idle");

    if (parked.state === "idle") {
      await parked.session.prompt("what next?");
    }
    assert.deepEqual(prompts, ["what next?"]);
    assert.deepEqual(reported, [outcome]);
  });

  it("reparks a stopped approval only after the harness cancel settles", async () => {
    const journal: string[] = [];
    let settlePrompt!: (value: unknown) => void;
    const promptPromise = new Promise<unknown>((resolve) => {
      settlePrompt = resolve;
    });
    const gate: ParkedApproval = {
      gateType: "claude-acp-permission",
      permissionId: "perm-a",
      toolCallId: "tool-a",
      toolName: "commit",
      args: {},
      interactionToken: "interaction-a",
      promptPromise,
    };
    const env = {
      sandbox: {
        cancelSession: async () => {
          journal.push("cancel");
          settlePrompt({ stopReason: "cancelled" });
        },
      },
      session: {
        id: "harness-session",
        respondPermission: async () => journal.push("reject"),
      },
      logger: () => {},
      parkedApprovals: new Map([[gate.toolCallId, gate]]),
      parkedApproval: gate,
      parkedApprovedExecutions: new Map([["approved", {}]]),
      approvalGateCount: 1,
      nonParkablePauseCount: 1,
      commitAuthorization: {},
      sessionDestroyRequested: false,
      clearTurn: () => journal.push("clear"),
    } as unknown as SessionEnvironment;
    let tornDown = 0;

    await stopParkedApprovalSession({
      environment: env,
      repark: async () => {
        journal.push("repark");
        return true;
      },
      teardown: async () => {
        tornDown += 1;
      },
      cancelSettleMs: 1,
      wait: async () => {},
    });

    assert.deepEqual(journal, ["reject", "cancel", "clear", "repark"]);
    assert.equal(env.parkedApprovals.size, 0);
    assert.equal(env.parkedApproval, undefined);
    assert.equal(env.sessionDestroyRequested, true);
    assert.equal(tornDown, 0);
  });

  it("tears down a stopped approval when the harness cancel does not settle", async () => {
    const journal: string[] = [];
    const gate: ParkedApproval = {
      gateType: "claude-acp-permission",
      permissionId: "perm-a",
      toolCallId: "tool-a",
      toolName: "commit",
      args: {},
      interactionToken: "interaction-a",
      promptPromise: new Promise(() => {}),
    };
    const env = {
      sandbox: {
        cancelSession: async () => journal.push("cancel"),
      },
      session: {
        id: "harness-session",
        respondPermission: async () => journal.push("reject"),
      },
      logger: () => {},
      parkedApprovals: new Map([[gate.toolCallId, gate]]),
      parkedApproval: gate,
      parkedApprovedExecutions: new Map(),
      approvalGateCount: 1,
      nonParkablePauseCount: 0,
      sessionDestroyRequested: false,
      clearTurn: () => journal.push("clear"),
    } as unknown as SessionEnvironment;

    await assert.rejects(
      stopParkedApprovalSession({
        environment: env,
        repark: async () => {
          journal.push("repark");
          return true;
        },
        teardown: async () => {
          journal.push("teardown");
        },
        cancelSettleMs: 1,
        wait: async () => {
          journal.push("timeout");
        },
      }),
      /parked approval harness cancel did not settle/,
    );

    assert.deepEqual(journal, [
      "reject",
      "cancel",
      "timeout",
      "timeout",
      "teardown",
    ]);
    assert.equal(env.parkedApprovals.size, 1);
    assert.equal(env.sessionDestroyRequested, true);
  });

  it("reparks a parked approval warm when the sandbox client has no cancelSession", async () => {
    // The local provider's sandbox client can lack `cancelSession` (an older runtime), so the
    // runner cannot send the ACP session/cancel and `cancelHarnessTurn` answers
    // `sent=false reason=client-has-no-cancelSession`. A parked approval runs no turn, and the
    // reject below is still the stop signal, so the environment must repark WARM and the Stop must
    // report `stopped` — never tear the sandbox down and report a failed cancel.
    const journal: string[] = [];
    const gate: ParkedApproval = {
      gateType: "claude-acp-permission",
      permissionId: "perm-a",
      toolCallId: "tool-a",
      toolName: "commit",
      args: {},
      interactionToken: "interaction-a",
      // A prompt that never settles: without a cancelSession the runner never waits on it, so a
      // pending prompt must not block or fail the repark.
      promptPromise: new Promise(() => {}),
    };
    const env = {
      // No `cancelSession` on the sandbox client. This is the local-runtime case.
      sandbox: {},
      session: {
        id: "harness-session",
        respondPermission: async () => journal.push("reject"),
      },
      logger: () => {},
      parkedApprovals: new Map([[gate.toolCallId, gate]]),
      parkedApproval: gate,
      parkedApprovedExecutions: new Map([["approved", {}]]),
      approvalGateCount: 1,
      nonParkablePauseCount: 0,
      commitAuthorization: {},
      sessionDestroyRequested: false,
      clearTurn: () => journal.push("clear"),
    } as unknown as SessionEnvironment;
    let tornDown = 0;

    await stopParkedApprovalSession({
      environment: env,
      repark: async () => {
        journal.push("repark");
        return true;
      },
      teardown: async () => {
        tornDown += 1;
      },
      cancelSettleMs: 1,
      wait: async () => {},
    });

    // No cancel was sent, so the environment is reparked straight from the reject and never
    // tears down.
    assert.deepEqual(journal, ["reject", "clear", "repark"]);
    assert.equal(tornDown, 0, "a Stop must never evict the warm sandbox");
    assert.equal(env.parkedApprovals.size, 0);
    assert.equal(env.parkedApproval, undefined);
    // No cancel notification left the runner, so no destroy was ever requested for the session.
    assert.equal(env.sessionDestroyRequested, false);
  });

  it("stops a local parked approval, staying warm, and reports it stopped end to end", async () => {
    // The same case as above, but through `applyCommand`, which is what the /cancel route calls.
    // It proves the OUTCOME the API settles on: `applied` / `stopped`, which is what writes the
    // one terminal `session_executions` row. Before the fix this answered `applied` / `failed`,
    // which the API never records as a terminal execution.
    const { reported, report } = collector();
    const parked = { state: "awaiting_approval" as "awaiting_approval" | "idle" };
    let reparked = false;
    let tornDown = false;

    const env = {
      sandbox: {}, // no cancelSession
      session: {
        id: "harness-session",
        respondPermission: async () => {},
      },
      logger: () => {},
      parkedApprovals: new Map([
        [
          "tool-a",
          {
            gateType: "claude-acp-permission",
            permissionId: "perm-a",
            toolCallId: "tool-a",
            toolName: "commit",
            args: {},
            interactionToken: "interaction-a",
            promptPromise: new Promise(() => {}),
          } as ParkedApproval,
        ],
      ]),
      parkedApproval: undefined,
      parkedApprovedExecutions: new Map(),
      approvalGateCount: 1,
      nonParkablePauseCount: 0,
      commitAuthorization: {},
      sessionDestroyRequested: false,
      clearTurn: () => {},
    } as unknown as SessionEnvironment;

    const outcome = await applyCommand(command(), {
      findLive: () => undefined,
      isParked: (projectId, sessionId) =>
        projectId === PROJECT &&
        sessionId === SESSION &&
        parked.state === "awaiting_approval"
          ? {
              stop: () =>
                stopParkedApprovalSession({
                  environment: env,
                  repark: async () => {
                    reparked = true;
                    parked.state = "idle";
                    return true;
                  },
                  teardown: async () => {
                    tornDown = true;
                  },
                  cancelSettleMs: 1,
                  wait: async () => {},
                }),
            }
          : undefined,
      report,
    });

    assert.equal(outcome.result, "applied");
    assert.equal(outcome.execution.state, "stopped");
    assert.equal(outcome.execution.id, TURN);
    assert.equal(reparked, true, "the warm sandbox returns to the pool");
    assert.equal(tornDown, false, "and is never evicted");
    assert.equal(parked.state, "idle");
    assert.deepEqual(reported, [outcome]);
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

  it("aborts with the user-stop label, which is what lets the sandbox park", async () => {
    // The registry hands the applier whatever abort the transport registered. `shouldPark`
    // parks only an abort the runner can prove was a cooperative Stop, so an unlabelled abort
    // here would end the turn `cancelled` and then DESTROY the sandbox. This pins the contract
    // the applier depends on; `server.ts` is where the label is actually attached.
    const controller = new AbortController();
    const execution: LiveExecution = {
      projectId: PROJECT,
      sessionId: SESSION,
      turnId: TURN,
      startedAt: 900,
      abort: () => controller.abort(USER_STOP_ABORT_REASON),
    };
    const { report } = collector();

    await applyCommand(command(), { findLive: () => execution, report });

    assert.equal(isUserStopAbort(controller.signal), true);
    assert.equal(
      shouldPark(
        { ok: true, stopReason: "cancelled", cancelSettled: true },
        controller.signal,
        undefined,
      ),
      true,
      "a Stop delivered as a command must leave the sandbox parkable",
    );
  });

  it("does NOT park when the abort carries no label", () => {
    // The regression this guards: the first version of the control route called
    // `controller.abort()` with no reason, so every Stop through it destroyed the sandbox.
    const controller = new AbortController();
    controller.abort();

    assert.equal(isUserStopAbort(controller.signal), false);
    assert.equal(
      shouldPark(
        { ok: true, stopReason: "cancelled", cancelSettled: true },
        controller.signal,
        undefined,
      ),
      false,
    );
  });

  it("aborts nothing when the named execution's prompt has already settled", async () => {
    // The race the user cannot see: the answer lands, they press Stop a moment later, and the
    // entry is still registered because teardown is writing the transcript and parking the
    // sandbox. Aborting here stops nothing and makes teardown destroy a healthy environment.
    const { execution, aborts } = liveRun({ settled: true });
    const { reported, report } = collector();

    const outcome = await applyCommand(command(), {
      findLive: () => execution,
      report,
    });

    assert.equal(aborts.length, 0, "a finished run must not be aborted");
    assert.equal(outcome.result, "obsolete", "the command stopped nothing");
    assert.equal(outcome.execution.state, "not_running");
    assert.equal(outcome.execution.id, TURN);
    assert.deepEqual(reported, [outcome], "and it still acknowledges");
  });

  it("still aborts an execution whose prompt has NOT settled", async () => {
    // The guard must be the flag and not the mere presence of teardown, or every Stop becomes
    // a no-op and Stop stops working.
    const { execution, aborts } = liveRun({ settled: false });
    const { report } = collector();

    const outcome = await applyCommand(command(), {
      findLive: () => execution,
      report,
    });

    assert.equal(aborts.length, 1);
    assert.equal(outcome.execution.state, "stopped");
  });

  it("parks the environment of a finished turn that a late Stop did not abort", () => {
    // The consequence the fix exists for, stated as the teardown sees it. No abort means no
    // aborted signal, so a normally finished turn takes the ordinary park path.
    const controller = new AbortController();
    assert.equal(
      shouldPark(
        { ok: true, stopReason: "end_turn" } as never,
        controller.signal,
        undefined,
      ),
      true,
      "an un-aborted, cleanly finished turn parks",
    );
    // And this is what used to happen instead: the late abort fired, and the same finished
    // turn was destroyed rather than parked.
    controller.abort(USER_STOP_ABORT_REASON);
    assert.equal(
      shouldPark(
        { ok: true, stopReason: "end_turn" } as never,
        controller.signal,
        undefined,
      ),
      false,
      "which is why the applier must not abort a settled run",
    );
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

describe("Stop teardown before outcome", () => {
  it("aborts once immediately but holds original and duplicate outcomes until release", async () => {
    const { execution, aborts } = liveRun();
    registerExecution(execution);
    const { reported, report } = collector();
    const first = applyCommand(command(), { report });
    const duplicate = applyCommand(command(), { report });
    await Promise.resolve();
    assert.equal(aborts.length, 1);
    assert.equal(
      reported.length,
      0,
      "Steer cannot promote into the still-busy environment",
    );
    noteExecutionSettled(SESSION, TURN);
    await Promise.resolve();
    assert.equal(reported.length, 0, "prompt settlement precedes teardown");
    unregisterExecution(SESSION, TURN);
    await Promise.all([first, duplicate]);
    assert.equal(reported.length, 2);
    assert.ok(
      reported.every((outcome) => outcome.execution.state === "stopped"),
    );
  });

  it("reports failure for an abandoned turn, including an already-waiting duplicate", async () => {
    registerExecution(liveRun().execution);
    const { reported, report } = collector();
    const first = applyCommand(command(), { report });
    const duplicate = applyCommand(command(), { report });
    unregisterExecution(SESSION, TURN, false);
    await Promise.all([first, duplicate]);
    assert.equal(reported.length, 2);
    assert.ok(
      reported.every((outcome) => outcome.execution.state === "failed"),
    );
  });

  it("does not strand a duplicate when abort throws before teardown", async () => {
    registerExecution(
      liveRun({
        abort: () => {
          throw new Error("abort failed");
        },
      }).execution,
    );
    const { reported, report } = collector();
    await Promise.all([
      applyCommand(command(), { report }),
      applyCommand(command(), { report }),
    ]);
    assert.equal(reported.length, 2);
    assert.ok(
      reported.every((outcome) => outcome.execution.state === "failed"),
    );
    unregisterExecution(SESSION, TURN);
  });

  it("does not let unregistering an older execution release its successor", async () => {
    const older = liveRun({ turnId: "older" }).execution;
    const current = liveRun().execution;
    registerExecution(older);
    registerExecution(current);
    const { reported, report } = collector();
    const pending = applyCommand(command(), { report });
    unregisterExecution(SESSION, "older");
    await Promise.resolve();
    assert.equal(reported.length, 0);
    unregisterExecution(SESSION, TURN);
    await pending;
    assert.equal(reported.length, 1);
  });
});

describe("the execution registry", () => {
  it("refuses a lookup from another project once the scope is known", () => {
    const { execution } = liveRun();
    registerExecution(execution);

    assert.equal(findExecution(PROJECT, SESSION)?.turnId, TURN);
    assert.equal(
      findExecution("22222222-2222-4222-8222-222222222222", SESSION),
      undefined,
      "two projects may use the same session id; the project is the tenant boundary",
    );
  });

  it("matches any project until the coordinator has resolved the scope", () => {
    // `runContext.project.id` is empty on the live invoke path, so a run is registered before
    // its project is known. Refusing every Stop in that window is what made the first version
    // of this registry answer 404 for every real Stop.
    registerExecution(liveRun({ projectId: undefined }).execution);

    assert.equal(findExecution(PROJECT, SESSION)?.turnId, TURN);

    noteExecutionProject(SESSION, TURN, PROJECT);
    assert.equal(
      findExecution("22222222-2222-4222-8222-222222222222", SESSION),
      undefined,
      "once the scope is known, another tenant is refused",
    );
  });

  it("does not let a late scope callback relabel a successor turn", () => {
    registerExecution(liveRun({ turnId: "turn-2", projectId: undefined }).execution);

    noteExecutionProject(SESSION, "turn-1", "some-other-project");

    assert.equal(findExecution(PROJECT, SESSION)?.projectId, undefined);
  });

  it("marks only the turn it names as settled", () => {
    registerExecution({
      projectId: PROJECT,
      sessionId: SESSION,
      turnId: TURN,
      startedAt: 900,
      abort: () => {},
    });

    // A late callback from a turn that has already been replaced must not mark the successor
    // finished, which would make every Stop on the live turn a no-op.
    noteExecutionSettled(SESSION, "some-older-turn");
    assert.equal(findExecution(PROJECT, SESSION)?.settled, undefined);

    noteExecutionSettled(SESSION, TURN);
    assert.equal(findExecution(PROJECT, SESSION)?.settled, true);
  });

  it("does not let a finished turn unregister its successor", () => {
    const first = liveRun({ turnId: "turn-1" }).execution;
    const second = liveRun({ turnId: "turn-2" }).execution;
    registerExecution(first);
    registerExecution(second);

    unregisterExecution(SESSION, "turn-1");

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
      holdsSession(PROJECT, SESSION, (projectId, sessionId) =>
        projectId === PROJECT && sessionId === SESSION
          ? { stop: () => {} }
          : undefined,
      ),
      true,
    );
  });

  it("does not match a parked session with the same id in another project", () => {
    assert.equal(
      holdsSession(
        PROJECT,
        SESSION,
        (projectId, sessionId) =>
          projectId === "22222222-2222-4222-8222-222222222222" &&
          sessionId === SESSION
            ? { stop: () => {} }
            : undefined,
      ),
      false,
    );
  });

  it("is false for a session this process does not hold, which is what answers 404", () => {
    assert.equal(
      holdsSession(PROJECT, "other-session", () => undefined),
      false,
    );
  });
});

describe("reportOutcome", () => {
  it("rejects redirects so the runner token cannot be forwarded", async () => {
    const previousToken = process.env.AGENTA_RUNNER_TOKEN;
    const previousFetch = globalThis.fetch;
    let captured: RequestInit | undefined;
    process.env.AGENTA_RUNNER_TOKEN = "shared-secret";
    globalThis.fetch = (async (_input, init) => {
      captured = init;
      return new Response("{}", { status: 200 });
    }) as typeof fetch;

    try {
      await reportOutcome(command(), {
        result: "applied",
        execution: { id: TURN, state: "stopped" },
      });
    } finally {
      globalThis.fetch = previousFetch;
      if (previousToken === undefined) delete process.env.AGENTA_RUNNER_TOKEN;
      else process.env.AGENTA_RUNNER_TOKEN = previousToken;
    }

    assert.equal(captured?.redirect, "error");
  });
});
