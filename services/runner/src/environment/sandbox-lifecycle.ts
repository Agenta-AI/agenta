/**
 * `SandboxLifecycle` — the provider instance.
 *
 * LIFECYCLE MIGRATION, STEP 5. This unit owns the `sandbox_start` acquire stage and the sandbox
 * half of teardown. It is a pure code move: the reconnect ladder, the fresh-create fallback, the
 * park-versus-delete decision, and the in-flight registry all behave exactly as they did inline.
 *
 * TWO EVENTS, ONE STAGE NAME. `acquire` may reconnect a parked sandbox or create a fresh one. Both
 * emit `sandbox_start`, and the mode rides the ` mode=...` field. A dashboard grouping by stage
 * therefore sees one series with a mode dimension, which is what the existing queries expect.
 *
 * THE RECONNECT LADDER NEVER FAILS A TURN. A stored id that will not reconnect degrades to a fresh
 * create. That is why the reconnect `catch` swallows: a dead sandbox is an ordinary outcome, not
 * an error, and the only cost is the round trip.
 */
import { conciseError } from "../engines/sandbox_agent/errors.ts";
import { DaytonaReconnectTerminalError } from "../engines/sandbox_agent/daytona-provider.ts";
import {
  markSandboxDestroyed,
  readStoredSandboxPointer,
} from "../engines/sandbox_agent/sandbox-reconnect.ts";
import {
  teardownDisposition,
  type TeardownReason,
} from "../engines/sandbox_agent/teardown.ts";
import type { Log, TimingLog } from "./timing.ts";

/** What `acquire` needs. Deliberately narrow: this unit never sees credentials or a workspace. */
export interface SandboxAcquireInput {
  /** Provider-agnostic start options, already built by the composer. */
  startOptions: Record<string, unknown>;
  isDaytona: boolean;
  harness: string;
  /** The session whose stored pointer may name a parked sandbox. Undefined disables reconnect. */
  sessionForMount: string | undefined;
  /** The run credential the pointer read needs. Undefined disables reconnect. */
  runCred: string | undefined;
  log: Log;
  timingLog: TimingLog;
}

export interface SandboxAcquireDeps {
  startSandboxAgent: (options: Record<string, unknown>) => Promise<unknown>;
  readStoredSandboxPointer?: typeof readStoredSandboxPointer;
}

export interface SandboxAcquireResult {
  sandbox: unknown;
  /** True when this sandbox may be parked and reconnected on a later turn. */
  resumable: boolean;
  /** Which path produced the handle. Reported for the composer's logs and for tests. */
  mode: "reconnect" | "create";
}

/**
 * Get a sandbox: reconnect a parked one when a pointer names it, otherwise create a fresh one.
 *
 * Byte-for-byte the inline behavior, including the swallowed reconnect failure and the extra log
 * line for a confirmed terminal Daytona state.
 */
export async function acquire(
  input: SandboxAcquireInput,
  deps: SandboxAcquireDeps,
): Promise<SandboxAcquireResult> {
  const { isDaytona, sessionForMount, runCred, log, timingLog } = input;

  // A stored sandbox id is trusted: reconnect it by id and let reconnect converge its network
  // policy to this run's plan. Any reconnect failure falls through to a fresh create. Snapshot
  // and image drift are accepted as per-conversation version pinning, not grounds for a rebuild.
  const storedSandboxPointer =
    isDaytona && sessionForMount && runCred
      ? await (deps.readStoredSandboxPointer ?? readStoredSandboxPointer)(
          sessionForMount,
          { authorization: runCred, log },
        )
      : undefined;

  let sandbox: unknown;
  let mode: "reconnect" | "create" = "create";

  if (storedSandboxPointer) {
    const sandboxStartStartedAt = Date.now();
    try {
      sandbox = await deps.startSandboxAgent({
        ...input.startOptions,
        sandboxId: storedSandboxPointer.sandboxId,
      });
      mode = "reconnect";
      log(
        `reconnected sandbox=${storedSandboxPointer.sandboxId} session=${sessionForMount}`,
      );
    } catch (err) {
      log(
        `reconnect failed sandbox=${storedSandboxPointer.sandboxId}, creating fresh: ${conciseError(err, input.harness)}`,
      );
      // No explicit pointer clear needed: turns are append-only, so the fresh sandbox this
      // turn creates below gets its own turn row at completion, and that row's higher
      // turn_index naturally supersedes the dead one on the next `latest_turn` read.
      if (err instanceof DaytonaReconnectTerminalError) {
        log(
          `terminal Daytona state '${err.state}' for sandbox=${storedSandboxPointer.sandboxId}, not retrying reconnect`,
        );
      }
    } finally {
      timingLog("sandbox_start", sandboxStartStartedAt, " mode=reconnect");
    }
  }

  if (!sandbox) {
    const sandboxStartStartedAt = Date.now();
    mode = "create";
    try {
      sandbox = await deps.startSandboxAgent(input.startOptions);
    } finally {
      timingLog("sandbox_start", sandboxStartStartedAt, " mode=create");
    }
  }

  return {
    sandbox,
    resumable: Boolean(isDaytona && sessionForMount),
    mode,
  };
}

export interface SandboxTeardownInput {
  sandbox: {
    sandboxId?: string;
    pauseSandbox?: () => Promise<unknown>;
    destroySandbox?: () => Promise<unknown>;
    dispose?: () => Promise<unknown>;
  } | undefined;
  /** The plan's id, used when the live handle carries none. */
  plannedSandboxId: string | undefined;
  isDaytona: boolean;
  harness: string;
  reason: TeardownReason | undefined;
  log: Log;
}

/**
 * How long any one provider teardown call may take before teardown moves on without it.
 *
 * "NEVER THROWS" WAS NOT ENOUGH. Every call below already swallowed its rejection, but a call
 * that never SETTLES hangs teardown just as hard, and teardown is what the failed run is waiting
 * on before it can answer the caller. That is not hypothetical: with an ACP request still in
 * flight against the daemon (an adapter that accepted `session/new` and never replied), the local
 * provider's dispose does not return, so a run that had already decided to fail never reached the
 * client at all. Bounding each step is what makes the promise in this doc true.
 *
 * The abandoned call keeps running; it is not cancelled, only stopped being waited on. Its own
 * backstops still apply: a Daytona delete has the provider's retry and the auto-stop timer behind
 * it, and a local daemon dies with the runner process.
 *
 * 30 seconds is well above a healthy stop or delete (hundreds of ms locally, a few seconds on
 * Daytona) and well below the API's 15-minute watchdog, which is the deadline this is racing.
 */
const TEARDOWN_STEP_TIMEOUT_MS = 30_000;

/**
 * Await one call, but never longer than the budget. Answers whether it settled in time.
 *
 * The work is NOT cancelled on expiry, only abandoned, so a no-op rejection handler goes on it up
 * front: the race still sees a rejection, and a late one cannot surface as an `unhandledRejection`
 * that the server prints as a mystery long after the run ended.
 */
async function withTeardownBudget(
  work: Promise<unknown>,
  onTimeout: () => void,
): Promise<boolean> {
  work.catch(() => {});
  const expired = Symbol("expired");
  let timer: NodeJS.Timeout | undefined;
  try {
    const outcome = await Promise.race([
      work.then(() => "settled" as const),
      new Promise<typeof expired>((resolve) => {
        timer = setTimeout(() => resolve(expired), TEARDOWN_STEP_TIMEOUT_MS);
        timer.unref?.();
      }),
    ]);
    if (outcome === expired) {
      onTimeout();
      return false;
    }
    return true;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Run one teardown step to completion, to failure, or to the budget, whichever comes first.
 *
 * Swallows a rejection like the call sites always did, and reports either outcome, because an
 * unfinished stop or delete is the only warning an operator gets that a sandbox may still exist.
 */
async function boundedStep(
  step: string,
  work: Promise<unknown> | undefined,
  sandboxLogId: string | undefined,
  harness: string,
  log: Log,
): Promise<void> {
  if (!work) return;
  await withTeardownBudget(
    work.catch((err: unknown) => {
      log(
        `sandbox ${step} failed sandbox=${sandboxLogId}: ${conciseError(err, harness)}`,
      );
    }),
    () =>
      log(
        `sandbox ${step} did not finish within ${TEARDOWN_STEP_TIMEOUT_MS}ms sandbox=${sandboxLogId}; ` +
          "continuing teardown without it",
      ),
  );
}

/**
 * Stop or delete the sandbox, and say which happened.
 *
 * `parked` is returned because the caller needs it: a parked Daytona sandbox keeps its agent
 * mount, so the mount unit's teardown is gated on this answer. That coupling is why the composer
 * still sequences the units rather than each unit tearing itself down independently.
 *
 * Never throws, and never hangs: each provider call is bounded (see `TEARDOWN_STEP_TIMEOUT_MS`).
 */
export async function teardown(
  input: SandboxTeardownInput,
): Promise<{ parked: boolean }> {
  const { sandbox, log } = input;
  const disposition = teardownDisposition(input.reason ?? "failed-turn");
  const sandboxLogId = sandbox?.sandboxId ?? input.plannedSandboxId;
  let parked = false;

  if (disposition === "stop" && input.isDaytona && sandbox?.pauseSandbox) {
    // A pause that times out is NOT treated as parked: `parked` gates whether the agent mount is
    // torn down, and claiming a park we never confirmed would strand the mount.
    let paused = false;
    try {
      paused = await withTeardownBudget(sandbox.pauseSandbox(), () =>
        log(
          `pause did not finish within ${TEARDOWN_STEP_TIMEOUT_MS}ms sandbox=${sandboxLogId}`,
        ),
      );
    } catch (err) {
      log(
        `pause failed sandbox=${sandboxLogId}: ${conciseError(err, input.harness)}`,
      );
    }
    if (paused) {
      parked = true;
      log(`parked sandbox=${sandboxLogId}`);
    }
  }

  if (!parked) {
    // Record the id BEFORE the delete call, and record it even when the call throws. A delete
    // that failed may still have removed the sandbox, so reconnecting to it is a wasted round
    // trip either way. See `markSandboxDestroyed`.
    markSandboxDestroyed(sandbox?.sandboxId ?? input.plannedSandboxId ?? undefined);
    // SWALLOWED, BUT NEVER SILENT. Teardown must always complete, so the rejection cannot
    // propagate — but it is the only signal that a remote sandbox, and on Daytona the Secret
    // mounted into it, may still exist. It used to vanish here, so a stranded pair left no trace
    // at all. The Daytona provider arms its own retry on this same failure; this line is what
    // tells an operator it happened. `conciseError` reads only the top-level message, which for
    // a Secret cleanup failure is a fixed sentence, so no Secret id or value can reach the log.
    await boundedStep(
      "delete",
      sandbox?.destroySandbox?.(),
      sandboxLogId,
      input.harness,
      log,
    );
  }
  await boundedStep(
    "dispose",
    sandbox?.dispose?.(),
    sandboxLogId,
    input.harness,
    log,
  );

  return { parked };
}
