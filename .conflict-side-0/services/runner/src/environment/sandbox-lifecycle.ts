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
 * Stop or delete the sandbox, and say which happened.
 *
 * `parked` is returned because the caller needs it: a parked Daytona sandbox keeps its agent
 * mount, so the mount unit's teardown is gated on this answer. That coupling is why the composer
 * still sequences the units rather than each unit tearing itself down independently.
 *
 * Never throws. Teardown must always complete.
 */
export async function teardown(
  input: SandboxTeardownInput,
): Promise<{ parked: boolean }> {
  const { sandbox, log } = input;
  const disposition = teardownDisposition(input.reason ?? "failed-turn");
  let parked = false;

  if (disposition === "stop" && input.isDaytona && sandbox?.pauseSandbox) {
    const sandboxLogId = sandbox.sandboxId ?? input.plannedSandboxId;
    try {
      await sandbox.pauseSandbox();
      parked = true;
      log(`parked sandbox=${sandboxLogId}`);
    } catch (err) {
      log(
        `pause failed sandbox=${sandboxLogId}: ${conciseError(err, input.harness)}`,
      );
    }
  }

  if (!parked) {
    // Record the id BEFORE the delete call, and record it even when the call throws. A delete
    // that failed may still have removed the sandbox, so reconnecting to it is a wasted round
    // trip either way. See `markSandboxDestroyed`.
    markSandboxDestroyed(sandbox?.sandboxId ?? input.plannedSandboxId ?? undefined);
    await sandbox?.destroySandbox?.().catch(() => {});
  }
  await sandbox?.dispose?.().catch(() => {});

  return { parked };
}
