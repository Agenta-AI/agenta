/**
 * `AcquireContext` — the shared state the lifecycle units read and write.
 *
 * LIFECYCLE MIGRATION, STEP 5 (S7b). REVISION 2, after an external security review REJECTED
 * revision 1. That review's findings are recorded at the bottom of this file, because each one
 * describes a way the type could have looked correct and enforced nothing.
 *
 * ============================================================================================
 * WHY A CONTEXT OBJECT AT ALL
 * ============================================================================================
 *
 * The three remaining units (mount, runtime, harness session) are not separable the way sandbox
 * and workspace were. They share ONE closure containing six mutually recursive helpers:
 *
 *   activateAgentMountGuidance          mountLocalAgentCwd
 *   mountLocalDurableCwd                reSignAndRemountLocalAgentMount
 *   reSignAndRemountLocalCwd            remountLocalCwdAfterRuntimeEnotconn
 *
 * `mountLocalAgentCwd` calls `activateAgentMountGuidance`, which writes the DAEMON ENV and the
 * PLAN's system prompt. `reSignAndRemountLocalCwd` re-signs a credential and then calls
 * `mountLocalDurableCwd`. `remountLocalCwdAfterRuntimeEnotconn` calls both re-signers.
 *
 * A context object is the smallest change that lets those helpers live in separate modules
 * without any of them importing another. Every helper takes `ctx`; nothing captures.
 *
 * ============================================================================================
 * THE ENFORCEMENT RULE THIS REVISION IS BUILT ON
 * ============================================================================================
 *
 * Revision 1 stated its invariants in comments and exposed the mutable environment anyway. The
 * reviewer's summary was exact: "The type compiles, but it does not enforce what its comments
 * promise." So this revision follows one rule:
 *
 *   IF A COMMENT SAYS A UNIT MAY NOT DO SOMETHING, THE TYPE MUST MAKE IT IMPOSSIBLE.
 *
 * Concretely: units receive `EnvironmentView`, a read-only PROJECTION. The mutable
 * `SessionEnvironment` never leaves this module. Every write goes through a named committer, so
 * the set of writers is the set of methods below and a reviewer can enumerate them.
 *
 * ============================================================================================
 * THE THREE ORDERING INVARIANTS
 * ============================================================================================
 *
 * ---- INVARIANT 1: LOCAL MOUNTS RUN BEFORE THE PROVIDER FREEZES THE DAEMON ENV ----
 *
 * On a LOCAL run the daemon has not started when the mounts run, so the env maps are still
 * mutable and a successful mount can advertise itself through `AGENT_MOUNT_ENV_VAR`.
 * `buildSandboxProvider` takes them BY REFERENCE (environment.ts:641-647) and hands them to
 * `SandboxAgent.start`; after that the daemon environment is fixed for the life of the sandbox.
 *
 * Today the ordering is guaranteed by POSITION: the two `mountLocal*` calls sit immediately above
 * the `buildSandboxProvider` call. Once they live in different modules, position guarantees
 * nothing, and the failure is silent — a harness that cannot see its own durable storage.
 *
 * On DAYTONA the ordering is reversed and the env channel is unavailable: the sandbox is created
 * first, its env can never change, and the harness learns about the mount through the post-mount
 * system-prompt upload and a cwd-local symlink instead.
 *
 * ENFORCEMENT, CORRECTED. Revision 1 threw a plain `Error`, which `mountLocalAgentCwd`'s broad
 * catch (environment.ts:478) would have swallowed — the guidance call sits INSIDE that try. So
 * the throw is now `AcquireInvariantError`, and every operational catch in the mount unit must
 * rethrow it. The distinction the reviewer drew is the right one and is now expressible:
 *
 *   a PROGRAMMING-ORDER violation  -> AcquireInvariantError -> fails the acquisition, loudly
 *   an OPERATIONAL mount failure   -> any other error       -> logged, and the run continues
 *
 * ---- INVARIANT 2: A RE-SIGN COMMITS THROUGH ONE COMMITTER ----
 *
 * Exactly two credential re-sign paths exist:
 *
 *   reSignAndRemountLocalCwd        signMount(session)   -> mountCreds      -> mountLocalDurableCwd
 *   reSignAndRemountLocalAgentMount signAgentMount(art)  -> agentMountCreds -> mountLocalAgentCwd
 *
 * Each writes the fresh credential and THEN remounts. PRESERVED FOR THIS SPLIT, per the
 * reviewer's ruling: it is current behavior, and changing it does not belong in a zero-change
 * refactor.
 *
 * CORRECTION TO REVISION 1's NOTE. Revision 1 claimed a failed remount leaves nothing pointing at
 * a mount, "so nothing reads a credential it did not mount with". That was WRONG, and the
 * reviewer caught it: `mountLocalDurableCwd` sets `durableCwdSafeToDelete = false` and then, on a
 * failed mount, returns without clearing `mountedCwd`. A cwd remount that fails can therefore
 * leave `mountedCwd` STILL SET from the previous successful mount, while `mountCreds` holds the
 * new credential. The two disagree until the next successful remount. That is the real current
 * behavior; it is preserved, and it is written down here so it is not rediscovered as a surprise.
 *
 * ---- INVARIANT 3: THE EXPIRY IS STAMPED FROM THE CREDENTIAL THAT WAS ACTUALLY MOUNTED ----
 *
 * `installedMountExpiries` is what the keep-alive pool compares to decide whether a parked
 * session's mount can still cover a turn. It must record the expiry of the credential the daemon
 * RECEIVED, never one that was merely signed.
 *
 * CORRECTION TO REVISION 1's SHAPE. A single `commitMount(kind, path, credential)` could not
 * express what Daytona actually does. On Daytona the cwd mount records an expiry and does NOT set
 * `mountedCwd` (environment.ts:768-772), because `mountedCwd` exists to gate the HOST unmount at
 * teardown and a Daytona mount lives inside the sandbox, dying with it. Forcing a path in would
 * have made teardown try to unmount a host path that never existed. So there are now two
 * committers, and the difference is explicit rather than accidental.
 */
import type { MountCredentials } from "../engines/sandbox_agent/mount.ts";
import type { RunPlan } from "../engines/sandbox_agent/run-plan.ts";
import type { SessionEnvironment } from "../engines/sandbox_agent/runtime-contracts.ts";
import type { Log, TimingLog } from "./timing.ts";

/** Which of the two durable mounts a call is about. */
export type MountKind = "cwd" | "agent";

/**
 * A violation of an acquire ORDERING rule. It means the code called things in the wrong order,
 * which is a bug in the runner, not a condition of the environment.
 *
 * It must escape every operational catch. A mount unit that catches broadly has to rethrow this
 * class specifically; `rethrowIfInvariant` below is the one-liner for that, so no call site has
 * to remember the instanceof check.
 */
export class AcquireInvariantError extends Error {
  readonly invariant: string;
  constructor(invariant: string, message: string) {
    super(message);
    this.name = "AcquireInvariantError";
    this.invariant = invariant;
  }
}

/**
 * Rethrow `err` when it is an invariant violation; otherwise return it for ordinary handling.
 *
 * Every broad `catch` in the mount and runtime units starts with this call. That is what keeps
 * invariant 1's throw from being swallowed by the catch at environment.ts:478.
 */
export function rethrowIfInvariant(err: unknown): unknown {
  if (err instanceof AcquireInvariantError) throw err;
  return err;
}

/**
 * The READ-ONLY projection of the environment that units receive.
 *
 * This is the reviewer's first required change. `readonly environment: SessionEnvironment` was an
 * illusion: `readonly` freezes the reference, not the object, so every unit could still assign
 * every writable field and the ownership table was documentation rather than structure.
 *
 * Only the fields units legitimately READ are here. A unit that needs a new one adds it here,
 * which is a visible, reviewable act rather than a silent reach into a shared object.
 */
export interface EnvironmentView {
  readonly sandbox: unknown;
  readonly session: unknown;
  readonly sessionId: string;
  readonly mountCreds: MountCredentials | null;
  readonly agentMountCreds: MountCredentials | null | undefined;
  readonly mountedCwd: string | undefined;
  readonly agentMountedPath: string | undefined;
  readonly runAgentDir: string | undefined;
  readonly durableCwdSafeToDelete: boolean;
  readonly runtimeRemount: Promise<boolean> | undefined;
}

/**
 * The state shared across the mount, runtime, and harness-session units.
 *
 * Read the method list as the complete set of writers. There is no other way to change the
 * environment from a unit, because the mutable object is not reachable from this interface.
 */
export interface AcquireContext {
  // ---------------------------------------------------------------------------------------
  // IDENTITY AND PLAN
  // ---------------------------------------------------------------------------------------

  /**
   * The run plan, read-only.
   *
   * NOTE, per the reviewer: `readonly plan: RunPlan` does NOT prevent nested mutation, so this
   * annotation is not the protection. `appendAgentMountGuidance` below is. The plan is exposed
   * for reads; the one legitimate write goes through that method.
   */
  readonly plan: RunPlan;

  /** What units may read of the environment. The mutable object stays private to this module. */
  readonly env: EnvironmentView;

  /** The session id whose mount is being signed. Undefined disables the durable cwd mount. */
  readonly sessionForMount: string | undefined;
  /** The artifact id whose agent mount is being signed. Undefined disables the agent mount. */
  readonly artifactId: string | undefined;
  /** The caller credential every re-sign presents. Undefined disables BOTH re-sign paths. */
  readonly runCred: string | undefined;

  readonly log: Log;
  readonly timingLog: TimingLog;

  // ---------------------------------------------------------------------------------------
  // DAEMON ENVIRONMENT. Writer: the mount unit's guidance path. Frozen by: the sandbox unit.
  // INVARIANT 1.
  // ---------------------------------------------------------------------------------------

  /** True once `buildSandboxProvider` has taken the env maps by reference. */
  readonly envFrozen: boolean;

  /**
   * Set a daemon environment variable on both the daemon env and the Pi extension env.
   *
   * THROWS `AcquireInvariantError` when `envFrozen`. Both maps are written together because they
   * are always written together today; splitting them would let the extension and the daemon
   * disagree about where the agent mount is.
   */
  writeDaemonEnv(name: string, value: string): void;

  /** Called by the sandbox unit immediately before `buildSandboxProvider`. Idempotent. */
  freezeDaemonEnv(): void;

  // ---------------------------------------------------------------------------------------
  // THE PLAN'S SYSTEM PROMPT. Writer: the mount unit's guidance path.
  // ---------------------------------------------------------------------------------------

  /**
   * Append the durable-storage paragraph to the plan's system prompt and mark the plan as
   * carrying one.
   *
   * A narrow method rather than a raw mutable plan, per the reviewer's answer 4. Writing into the
   * plan from a lifecycle unit remains ugly; it is PRESERVED for this slice because S7b is a
   * zero-behavior-change split. Moving prompt composition behind a proper seam is follow-up work.
   */
  appendAgentMountGuidance(segment: string): void;

  /**
   * Re-prepare the local Pi assets and return the directory they landed in.
   *
   * A narrow injected callback, for the same reason `appendAgentMountGuidance` is one: the call
   * needs the raw daemon env map, and exposing that map to units would reopen the exact hole the
   * `EnvironmentView` projection closes. The composer wires this with the map it already owns.
   *
   * Only the guidance path calls it, and only on the subscription branch that has no agent dir
   * yet. The caller is still responsible for committing the result through `setRunAgentDir`.
   */
  reprepareLocalPiAssets(): string | undefined;

  // ---------------------------------------------------------------------------------------
  // MOUNT STATE. Writer: the mount unit ONLY, through the committers below.
  // ---------------------------------------------------------------------------------------

  /**
   * Record a credential that was just re-signed. INVARIANT 2.
   *
   * The ONLY writer of `mountCreds` and `agentMountCreds`. Takes a NON-NULL credential, per the
   * reviewer's answer 2: keeping the committer total forces each signer to handle and log its own
   * null result, which is what both signers already do.
   */
  recordResignedCredential(kind: MountKind, credential: MountCredentials): void;

  /**
   * Record a LOCAL mount that is now live: its host path and the expiry of the credential the
   * daemon actually received, written together. INVARIANT 3.
   *
   * Local only. The path matters because teardown must unmount that host mountpoint before
   * deleting anything under it.
   */
  commitLocalMount(
    kind: MountKind,
    path: string,
    credential: MountCredentials,
  ): void;

  /**
   * Record a DAYTONA cwd mount: the expiry ONLY, with no path.
   *
   * This is not a shortcut, it is the real behavior (environment.ts:768-772). A Daytona mount
   * lives inside the sandbox and dies with it, so there is no host mountpoint to unmount and
   * `mountedCwd` must stay unset. Setting it would make teardown attempt to unmount a path that
   * never existed on this host.
   */
  commitRemoteMountExpiry(kind: MountKind, credential: MountCredentials): void;

  /**
   * Clear a mount's path so a later attempt does not short-circuit.
   *
   * Used by the agent re-sign path, which clears `agentMountedPath` precisely so
   * `mountLocalAgentCwd` remounts instead of returning early on its identity check.
   */
  clearMountPath(kind: MountKind): void;

  // ---------------------------------------------------------------------------------------
  // `durableCwdSafeToDelete`. Writer: the mount unit and teardown.
  //
  // Revision 1's table hid this field's transitions behind `commitMount`. It has THREE, and they
  // are not all mount-success transitions, so they are modeled explicitly here.
  //
  //   beginCwdMount()               -> false   a mount is starting; the path may be live
  //                                            (environment.ts:443)
  //   markCwdDetachConfirmed()      -> true    mountStorage confirmed the path is detached
  //                                            (environment.ts:470)
  //   recordCwdUnmountResult(ok)    -> ok      teardown's unmount result (environment.ts:331)
  //
  // The field gates whether teardown may `rmSync` the workspace. A wrong `true` runs a recursive
  // delete against a possibly-live FUSE mount into the durable store, so every transition is
  // named rather than inferred.
  // ---------------------------------------------------------------------------------------

  beginCwdMount(): void;
  markCwdDetachConfirmed(): void;
  recordCwdUnmountResult(unmounted: boolean): void;

  // ---------------------------------------------------------------------------------------
  // RUNTIME-OWNED HANDLES. Writer: the runtime unit.
  // ---------------------------------------------------------------------------------------

  /**
   * The in-flight remount promise. Teardown awaits it FIRST, so a remount cannot land against a
   * half-torn-down environment.
   */
  setRuntimeRemount(remount: Promise<boolean> | undefined): void;

  /**
   * The per-run agent directory.
   *
   * SINGLE SOURCE OF TRUTH, mandated by the reviewer's answer 5. Today this is written twice: an
   * outer `let runAgentDir` in `acquireEnvironment` and `environment.runAgentDir`, both assigned
   * in `activateAgentMountGuidance` (environment.ts:433-434). The outer `let` has no reader left
   * in `acquireEnvironment`, so deleting it is not a behavior change — revision 1 was wrong to
   * call that "the one place S7b is not a pure move", and the reviewer corrected it.
   *
   * WRITER: the mount unit's GUIDANCE path, not the runtime unit. Revision 1's table assigned
   * this to runtime, which was simply wrong.
   */
  setRunAgentDir(dir: string | undefined): void;

  setOtlpAuthFilePath(path: string | undefined): void;
  setCodexSqliteHome(dir: string | undefined): void;
  setCloseToolMcp(close: (() => Promise<void>) | undefined): void;

  // ---------------------------------------------------------------------------------------
  // RETRY BUDGETS AND ONE-SHOT FLAGS. Writer: the mount unit.
  //
  // Three `let`s from the closure: two ENOTCONN remount counters (one per mount kind, both
  // bounded by the same `LOCAL_DURABLE_CWD_ENOTCONN_REMOUNT_LIMIT`) and one guidance flag.
  //
  // A budget is PER ACQUIRE, not per call site. An ENOTCONN storm must not be able to re-sign
  // forever, so every retry path for a given mount draws from the same counter — including the
  // runtime-event remount, which is why that path cannot become its own budget later without
  // reopening the loop this bound closes.
  // ---------------------------------------------------------------------------------------

  /** Consume one retry for `kind`. False when the budget is spent; the caller then gives up. */
  takeRemountBudget(kind: MountKind): boolean;

  /**
   * True once the agent-mount guidance has run. The guidance is idempotent by this flag rather
   * than by its effects, because it APPENDS to a system prompt and appending twice is visible.
   */
  readonly guidanceActive: boolean;
  markGuidanceActive(): void;
}

/**
 * The internal handle the composer builds. It holds the mutable environment; units never see it.
 *
 * The type is declared here so the boundary is visible in the reviewed artifact: exactly one
 * function may hold both halves.
 */
export interface AcquireContextHandle {
  readonly context: AcquireContext;
  /** The composer's own escape hatch, for the fields no unit owns. */
  readonly mutableEnvironment: SessionEnvironment;
}

/**
 * ============================================================================================
 * THE ENVIRONMENT FIELD MAP, CORRECTED
 * ============================================================================================
 *
 * | # | environment field        | owner unit          | written via                  |
 * |---|--------------------------|---------------------|------------------------------|
 * | 1 | `mountCreds`             | mount               | recordResignedCredential     |
 * | 2 | `agentMountCreds`        | mount               | recordResignedCredential     |
 * | 3 | `mountedCwd`             | mount (LOCAL only)  | commitLocalMount             |
 * | 4 | `agentMountedPath`       | mount               | commitLocalMount / clearMountPath |
 * | 5 | `installedMountExpiries` | mount               | commitLocalMount / commitRemoteMountExpiry |
 * | 6 | `durableCwdSafeToDelete` | mount + teardown    | beginCwdMount / markCwdDetachConfirmed / recordCwdUnmountResult |
 * | 7 | `runtimeRemount`         | runtime             | setRuntimeRemount            |
 * | 8 | `runAgentDir`            | mount (GUIDANCE)    | setRunAgentDir               |
 * | 9 | `otlpAuthFilePath`       | runtime             | setOtlpAuthFilePath          |
 * |10 | `codexSqliteHome`        | runtime             | setCodexSqliteHome           |
 * |11 | `closeToolMcp`           | runtime             | setCloseToolMcp              |
 *
 * Corrections against revision 1, all from the review:
 *   - #3 is LOCAL ONLY. Daytona records an expiry with no path (#5's second committer).
 *   - #6 has three named transitions, not one hidden inside a mount commit.
 *   - #8 is owned by the mount unit's guidance path. Revision 1 said runtime.
 *
 * Already split in S7a: `sandbox`, `resumable` (sandbox unit); `workspace` (workspace unit).
 * Owned by the harness-session unit: `session`, `sessionId`, `capabilities`, `model`,
 * `loadedFromContinuity`. None has an ordering hazard that warrants a committer.
 *
 * ============================================================================================
 * REVIEW RECORD
 * ============================================================================================
 *
 * Revision 1 was rejected. Every finding is addressed above; none was argued away.
 *
 * | Finding | Where it is fixed |
 * |---|---|
 * | `readonly environment` is only a readonly REFERENCE; units could mutate every field | `EnvironmentView`; the mutable object never leaves this module |
 * | The freeze throw would be swallowed by the broad catch at environment.ts:478 | `AcquireInvariantError` + `rethrowIfInvariant` |
 * | `commitMount` cannot represent Daytona's expiry-without-path | `commitLocalMount` vs `commitRemoteMountExpiry` |
 * | The table hid `durableCwdSafeToDelete`'s mount-start, detach, and teardown writes | three named transitions |
 * | `runAgentDir` is written by the guidance path, not runtime | field map #8 |
 * | The note wrongly claimed a failed remount leaves nothing pointing at a mount | invariant 2's correction paragraph |
 *
 * Rulings adopted as given: credential-before-remount PRESERVED for this split;
 * `recordResignedCredential` takes a non-null credential; the `plan.prompt` mutation is preserved
 * behind `appendAgentMountGuidance`; `environment.runAgentDir` is the single source of truth and
 * the outer `let` is deleted.
 */
export type AcquireContextReviewRecord = never;
