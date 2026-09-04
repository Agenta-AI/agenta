/**
 * Applying a control command, and reporting what it did.
 *
 * The applier sits ABOVE the transport, not inside it, so every delivery path shares one set of
 * guards and one deduplication set. Today there is one path, the direct `POST /cancel` route in
 * `server.ts`. A long-poll loop would call the same `applyCommand` and change nothing here.
 *
 * WHAT THE RUNNER DECIDES AND WHAT IT DOES NOT. It decides whether it holds the named execution
 * and whether that execution is old enough to be the one the user meant. It does NOT decide the
 * command's fate: it reports an outcome to the API, and the API settles the command and the
 * execution together. Settlement has one writer, on every transport.
 *
 * THE THREE ANSWERS.
 *
 *   stopped                  — this process held the target execution and aborted it.
 *   not_running              — it holds no execution that can still be stopped. A turn whose
 *                              prompt has already settled and is only tearing down answers this.
 *                              An approval-parked turn is still stoppable: its pending gate is
 *                              released and it answers `stopped` like a live execution.
 *   superseded_by_newer_turn — it holds an execution that STARTED AFTER the command was
 *                              created, so the command was meant for a turn that has since
 *                              ended. Nothing is aborted. This check is exact, because it
 *                              compares against this process's own memory of when it started
 *                              the run.
 */

import { apiBase } from "../apiBase.ts";
import { envTimerMs } from "../env.ts";
import { REPLICA_ID } from "./alive.ts";
import {
  recallCommand,
  rememberCommand,
  updateCommandOutcome,
} from "./applied-commands.ts";
import { findExecution, type LiveExecution } from "./execution-registry.ts";

function log(message: string): void {
  process.stderr.write(`[control] ${message}\n`);
}

/** One command as the API delivers it. The same shape arrives on every transport. */
export interface ControlCommand {
  id: string;
  projectId: string;
  sessionId: string;
  kind: "cancel";
  target: { turnId: string | null; expectedTurnId: string | null };
  /** When the API admitted the command. The late-Stop guard compares against this. */
  createdAt: string;
}

export type ExecutionState =
  | "stopped"
  | "failed"
  | "not_running"
  | "superseded_by_newer_turn";

export interface ControlOutcome {
  /** The command's terminal state, as the runner sees it. */
  result: "applied" | "obsolete";
  execution: {
    id: string | null;
    state: ExecutionState;
    error?: string;
  };
}

/** The control operation exposed by one approval-parked session. */
export interface ParkedSessionControl {
  /** Release every gate and return the same environment to the pool as idle. */
  stop(): Promise<void> | void;
}

/** How the runner reaches a parked session. Injected so tests need no pool. */
export interface ParkedLookup {
  (projectId: string, sessionId: string): ParkedSessionControl | undefined;
}

export interface ApplyCommandDeps {
  /** Overridden in tests. Defaults to the module-level execution registry. */
  findLive?: (
    projectId: string,
    sessionId: string,
  ) => LiveExecution | undefined;
  /** Whether the keep-alive pool holds this session parked awaiting an approval. */
  isParked?: ParkedLookup;
  /** Overridden in tests. Defaults to the HTTP report below. */
  report?: (command: ControlCommand, outcome: ControlOutcome) => Promise<void>;
  now?: () => number;
}

/** Does this process hold the session at all? The `/cancel` route answers 404 when it does not. */
export function holdsSession(
  projectId: string,
  sessionId: string,
  isParked?: ParkedLookup,
): boolean {
  if (findExecution(projectId, sessionId)) return true;
  return isParked ? isParked(projectId, sessionId) !== undefined : false;
}

/**
 * Apply one command and report its outcome. Never throws.
 *
 * Returns the outcome it reported, which is what a duplicate delivery repeats.
 */
export async function applyCommand(
  command: ControlCommand,
  deps: ApplyCommandDeps = {},
): Promise<ControlOutcome> {
  const findLive = deps.findLive ?? findExecution;
  const report = deps.report ?? reportOutcome;
  const now = deps.now ?? (() => Date.now());

  const seen = recallCommand(command.id, now());
  if (seen) {
    // A no-op that STILL acknowledges. Aborting a second time could kill a newer turn; not
    // acknowledging would leave the command open until the settlement sweep gave up on it.
    const outcome: ControlOutcome = {
      result: seen.result,
      execution: {
        id: seen.executionId,
        state: seen.executionState as ExecutionState,
      },
    };
    log(
      `duplicate command=${command.id} session=${command.sessionId} state=${seen.executionState}`,
    );
    await report(command, outcome).catch(() => {});
    return outcome;
  }

  const createdAtMs = Date.parse(command.createdAt);
  const live = findLive(command.projectId, command.sessionId);
  const parked = live
    ? undefined
    : deps.isParked?.(command.projectId, command.sessionId);
  const outcome = decideOutcome(command, live, parked, createdAtMs);

  // Remember BEFORE aborting. A duplicate that arrives while the first abort is still settling
  // must find the command already taken, not start a second one.
  rememberCommand(
    {
      commandId: command.id,
      executionId: outcome.execution.id,
      executionState: outcome.execution.state,
      result: outcome.result,
    },
    now(),
  );

  if (outcome.execution.state === "stopped") {
    try {
      if (live) {
        // The abort is the cancel. It makes the turn end `cancelled`, which is what sends the
        // ACP `session/cancel` to the harness and lets the environment be PARKED rather than
        // deleted (see `cancel-turn.ts` and `shouldPark`). Stop keeps the session warm.
        live.abort();
        log(
          `aborted command=${command.id} session=${command.sessionId} turn=${live.turnId}`,
        );
      } else if (parked) {
        // An approval park has no live execution to abort, but its harness still holds the
        // original prompt on one or more permission gates. Releasing those gates ends the work
        // and returns the SAME environment to the idle pool, so the next user message is a
        // normal warm prompt rather than an approval resume.
        await parked.stop();
        log(
          `released parked approval command=${command.id} session=${command.sessionId}`,
        );
      }
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : String(error ?? "abort failed");
      outcome.result = "applied";
      outcome.execution.state = "failed";
      outcome.execution.error = message.slice(0, 2000);
      updateCommandOutcome(command.id, {
        result: "applied",
        executionState: "failed",
      });
      log(
        `abort FAILED command=${command.id} session=${command.sessionId}: ${message}`,
      );
    }
  }

  // Reported as soon as the abort is issued, not after the harness settles. The command's job
  // is to deliver the Stop; the turn's own teardown then writes its transcript and parks the
  // sandbox on its own clock, which can take seconds. Waiting for it would make a Stop that
  // worked look stuck.
  await report(command, outcome).catch((error) => {
    log(
      `outcome report failed command=${command.id}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  });
  return outcome;
}

function decideOutcome(
  command: ControlCommand,
  live: LiveExecution | undefined,
  parked: ParkedSessionControl | undefined,
  createdAtMs: number,
): ControlOutcome {
  if (!live) {
    if (parked) {
      return {
        result: "applied",
        execution: { id: command.target.turnId, state: "stopped" },
      };
    }
    // No live or approval-parked turn is held here. There is nothing to stop.
    return {
      result: "applied",
      execution: { id: command.target.turnId, state: "not_running" },
    };
  }

  if (Number.isFinite(createdAtMs) && live.startedAt > createdAtMs) {
    // This execution began AFTER the user pressed Stop, so it is not the one they meant.
    return {
      result: "obsolete",
      execution: { id: live.turnId, state: "superseded_by_newer_turn" },
    };
  }

  if (command.target.turnId && command.target.turnId !== live.turnId) {
    // A different execution holds the session. The pinned target is gone.
    return {
      result: "obsolete",
      execution: { id: command.target.turnId, state: "not_running" },
    };
  }

  if (live.settled) {
    // THE STOP LOST THE RACE BY A MOMENT. The harness prompt already settled and the entry is
    // only still here because teardown is running: writing the transcript, exporting the trace,
    // parking the environment. There is nothing left to abort.
    //
    // Doing nothing is not merely tidier, it is the whole fix. `live.abort()` here would abort
    // a finished run, and the aborted signal then makes `shouldPark` refuse to park a healthy
    // idle environment, so the sandbox is destroyed and the user's next message rebuilds cold.
    // The user paid a cold start for pressing Stop as the answer landed.
    //
    // `obsolete`, not `applied`: the command never stopped anything. `not_running` is the same
    // answer a parked approval gets, and it means the same thing here — this process holds no
    // execution that can still be stopped.
    return {
      result: "obsolete",
      execution: {
        id: command.target.turnId ?? live.turnId,
        state: "not_running",
      },
    };
  }

  return {
    result: "applied",
    execution: { id: live.turnId, state: "stopped" },
  };
}

/**
 * Report a command's outcome to the API.
 *
 * Authenticates with the shared runner token, not a project credential: the runner holds no
 * project credential for a command it was handed, and the command id resolves the project on
 * the API side.
 */
export async function reportOutcome(
  command: ControlCommand,
  outcome: ControlOutcome,
): Promise<void> {
  const token = process.env.AGENTA_RUNNER_TOKEN;
  if (!token) {
    log(`cannot report command=${command.id}: AGENTA_RUNNER_TOKEN is not set`);
    return;
  }
  const url = `${apiBase()}/sessions/control/commands/${encodeURIComponent(command.id)}/outcome`;
  const res = await fetch(url, {
    method: "POST",
    redirect: "error",
    headers: {
      "content-type": "application/json",
      "x-agenta-runner-token": token,
    },
    body: JSON.stringify({
      replica_id: REPLICA_ID,
      result: outcome.result,
      execution: {
        id: outcome.execution.id,
        state: outcome.execution.state,
        ...(outcome.execution.error ? { error: outcome.execution.error } : {}),
      },
    }),
  });
  if (!res.ok) {
    // A 409 means the claim was gone, which is an answer, not a failure to retry: the API has
    // already written a terminal outcome for this command.
    log(
      `outcome HTTP ${res.status} command=${command.id} session=${command.sessionId}`,
    );
    return;
  }
  log(
    `outcome reported command=${command.id} session=${command.sessionId} state=${outcome.execution.state}`,
  );
}

/**
 * Confirm that a durable continuation command crossed the runner's admission barrier.
 *
 * Unlike Stop's best-effort terminal report, this acknowledgement is a prerequisite for starting
 * the continuation engine: without it the API could redeliver after a transport failure and run the
 * approved side effect twice. The API returns `admitted: true` only to the report that wins the
 * pending/claimed-to-applied transition. An already-applied duplicate returns `false`, which is a
 * successful acknowledgement but never permission to start an engine. A 409 is a real
 * command/execution mismatch and must not start the engine.
 */
export async function reportContinuationAdmission(input: {
  commandId: string;
  sessionId: string;
  executionId: string;
}): Promise<boolean> {
  const token = process.env.AGENTA_RUNNER_TOKEN;
  if (!token) {
    throw new Error("AGENTA_RUNNER_TOKEN is not set");
  }
  const url = `${apiBase()}/sessions/control/commands/${encodeURIComponent(input.commandId)}/outcome`;
  const res = await fetch(url, {
    method: "POST",
    signal: AbortSignal.timeout(
      envTimerMs("AGENTA_RUNNER_CONTROL_OUTCOME_TIMEOUT_MS", 5_000),
    ),
    headers: {
      "content-type": "application/json",
      "x-agenta-runner-token": token,
    },
    body: JSON.stringify({
      replica_id: REPLICA_ID,
      result: "applied",
      execution: {
        id: input.executionId,
        state: "started",
      },
    }),
  });
  if (!res.ok) {
    throw new Error(`continuation admission outcome HTTP ${res.status}`);
  }
  const response = (await res.json()) as { admitted?: unknown };
  if (typeof response.admitted !== "boolean") {
    throw new Error("continuation admission outcome omitted boolean admitted");
  }
  log(
    `continuation outcome command=${input.commandId} session=${input.sessionId} ` +
      `turn=${input.executionId} admitted=${response.admitted}`,
  );
  return response.admitted;
}
