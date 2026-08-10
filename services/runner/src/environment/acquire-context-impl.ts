/**
 * `createAcquireContext` — the one function allowed to hold both halves.
 *
 * LIFECYCLE MIGRATION, STEP 5 (S7b). The contract, its invariants, and the review record live in
 * `acquire-context.ts`. This file is the implementation, and it is deliberately separate so the
 * reviewed artifact stays readable.
 *
 * THE WHOLE POINT OF THIS MODULE is that the mutable `SessionEnvironment` enters here and does not
 * leave. Units get `context`, which exposes reads through `EnvironmentView` and writes through
 * named committers. The composer gets `mutableEnvironment` for the fields no unit owns.
 */
import { mountExpiryMs } from "../engines/sandbox_agent/session-identity.ts";
import type { MountCredentials } from "../engines/sandbox_agent/mount.ts";
import type { RunPlan } from "../engines/sandbox_agent/run-plan.ts";
import type { SessionEnvironment } from "../engines/sandbox_agent/runtime-contracts.ts";
import {
  AcquireInvariantError,
  type AcquireContext,
  type AcquireContextHandle,
  type EnvironmentView,
  type MountKind,
} from "./acquire-context.ts";
import type { Log, TimingLog } from "./timing.ts";

export interface CreateAcquireContextInput {
  environment: SessionEnvironment;
  plan: RunPlan;
  /** The daemon environment map. Taken by reference by `buildSandboxProvider`. */
  env: Record<string, string>;
  /** The Pi extension environment map. Also taken by reference. */
  piExtEnv: Record<string, string>;
  sessionForMount: string | undefined;
  artifactId: string | undefined;
  runCred: string | undefined;
  log: Log;
  timingLog: TimingLog;
  /** Shared cap for both ENOTCONN remount budgets. */
  remountLimit: number;
  /** Appends the guidance segment to an existing prompt. Injected to avoid a cycle. */
  combineAppendSystemPrompt: (
    existing: string | undefined,
    segment: string,
  ) => string;
  /**
   * Re-prepares the local Pi assets and returns their directory. Injected because it needs the
   * raw daemon env map, which units must not see.
   */
  reprepareLocalPiAssets: () => string | undefined;
}

export function createAcquireContext(
  input: CreateAcquireContextInput,
): AcquireContextHandle {
  const { environment, plan, env, piExtEnv } = input;

  let envFrozen = false;
  let guidanceActive = false;
  const remountsTaken: Record<MountKind, number> = { cwd: 0, agent: 0 };

  // The read-only projection. Getters, not a snapshot: a unit that reads `mountedCwd` after
  // another unit committed a mount must see the new value, exactly as the closure did.
  const view: EnvironmentView = {
    get sandbox() {
      return environment.sandbox;
    },
    get session() {
      return environment.session;
    },
    get sessionId() {
      return environment.sessionId;
    },
    get mountCreds() {
      return environment.mountCreds;
    },
    get agentMountCreds() {
      return environment.agentMountCreds;
    },
    get mountedCwd() {
      return environment.mountedCwd;
    },
    get agentMountedPath() {
      return environment.agentMountedPath;
    },
    get runAgentDir() {
      return environment.runAgentDir;
    },
    get durableCwdSafeToDelete() {
      return environment.durableCwdSafeToDelete;
    },
    get runtimeRemount() {
      return environment.runtimeRemount;
    },
  };

  const context: AcquireContext = {
    plan,
    env: view,
    sessionForMount: input.sessionForMount,
    artifactId: input.artifactId,
    runCred: input.runCred,
    log: input.log,
    timingLog: input.timingLog,

    // --- daemon env, INVARIANT 1 ------------------------------------------------------ //
    get envFrozen() {
      return envFrozen;
    },
    writeDaemonEnv(name, value) {
      if (envFrozen) {
        // A PROGRAMMING-ORDER violation, not an operational failure. It must fail the
        // acquisition rather than be swallowed by a mount unit's broad catch, which is why this
        // is `AcquireInvariantError` and why every such catch calls `rethrowIfInvariant` first.
        throw new AcquireInvariantError(
          "local-mounts-before-provider-freeze",
          `cannot set daemon env '${name}': the provider already took the env maps by ` +
            `reference, so the daemon environment is fixed. A local mount must complete ` +
            `BEFORE buildSandboxProvider.`,
        );
      }
      env[name] = value;
      piExtEnv[name] = value;
    },
    freezeDaemonEnv() {
      envFrozen = true;
    },

    // --- the plan's system prompt ----------------------------------------------------- //
    reprepareLocalPiAssets() {
      return input.reprepareLocalPiAssets();
    },
    appendAgentMountGuidance(segment) {
      plan.prompt.appendSystemPrompt = input.combineAppendSystemPrompt(
        plan.prompt.appendSystemPrompt,
        segment,
      );
      plan.prompt.hasSystemPrompt = true;
    },

    // --- mount state, INVARIANTS 2 and 3 ---------------------------------------------- //
    recordResignedCredential(kind, credential) {
      if (kind === "cwd") environment.mountCreds = credential;
      else environment.agentMountCreds = credential;
    },
    commitLocalMount(kind, path, credential) {
      // Path and expiry together, from ONE credential, so the recorded lease provably belongs to
      // the mount the daemon received.
      if (kind === "cwd") {
        environment.mountedCwd = path;
        environment.installedMountExpiries.cwd = mountExpiryMs(
          credential.expiresAt,
        );
      } else {
        environment.agentMountedPath = path;
        environment.installedMountExpiries.agent = mountExpiryMs(
          credential.expiresAt,
        );
      }
    },
    commitRemoteMountExpiry(kind, credential) {
      // Expiry with NO path. A Daytona mount lives inside the sandbox and dies with it, so there
      // is no host mountpoint for teardown to unmount.
      const expiry = mountExpiryMs(credential.expiresAt);
      if (kind === "cwd") environment.installedMountExpiries.cwd = expiry;
      else environment.installedMountExpiries.agent = expiry;
    },
    clearMountPath(kind) {
      if (kind === "cwd") environment.mountedCwd = undefined;
      else environment.agentMountedPath = undefined;
    },

    // --- durableCwdSafeToDelete: three named transitions ------------------------------ //
    beginCwdMount() {
      environment.durableCwdSafeToDelete = false;
    },
    markCwdDetachConfirmed() {
      environment.durableCwdSafeToDelete = true;
    },
    recordCwdUnmountResult(unmounted) {
      environment.durableCwdSafeToDelete = unmounted;
    },

    // --- runtime-owned handles -------------------------------------------------------- //
    setRuntimeRemount(remount) {
      environment.runtimeRemount = remount;
    },
    setRunAgentDir(dir) {
      environment.runAgentDir = dir;
    },
    setOtlpAuthFilePath(path) {
      environment.otlpAuthFilePath = path;
    },
    setCodexSqliteHome(dir) {
      environment.codexSqliteHome = dir;
    },
    setCloseToolMcp(close) {
      environment.closeToolMcp = close;
    },

    // --- retry budgets and one-shot flags --------------------------------------------- //
    takeRemountBudget(kind) {
      if (remountsTaken[kind] >= input.remountLimit) return false;
      remountsTaken[kind] += 1;
      return true;
    },
    get guidanceActive() {
      return guidanceActive;
    },
    markGuidanceActive() {
      guidanceActive = true;
    },
  };

  return { context, mutableEnvironment: environment };
}
