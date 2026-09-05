/**
 * `RuntimeLifecycle` — the agent daemon and the runner-owned files that live beside it.
 *
 * LIFECYCLE MIGRATION, STEP 5 (S7b). This unit owns the three handles nothing else owns:
 * the loopback tool-MCP server, the Codex SQLite home, and the per-run agent directory. It also owns the two teardown steps that must run FIRST.
 *
 * ============================================================================================
 * WHY THIS UNIT IS SMALL, AND WHY THAT IS THE HONEST ANSWER
 * ============================================================================================
 *
 * The lifecycle design gives the runtime a large role: `bootstrap`, `reconfigure`, `restart`. It
 * has none of that here, because the runner cannot do any of it yet. The daemon environment is
 * built ONCE, before the sandbox starts, and is immutable afterwards (see `AcquireContext`'s
 * invariant 1). There is no restart path and no credential refresh.
 *
 * So this unit is the runtime's TEARDOWN and its file handles, and nothing more. Inventing a
 * `restart()` that throws would suggest the seam exists; leaving it out says plainly that it does
 * not. Step 8 of the migration is where a real runtime reconfigure gets designed.
 *
 * ============================================================================================
 * TEARDOWN ORDERING IS LOAD-BEARING
 * ============================================================================================
 *
 * `teardownInFlight` must run BEFORE anything else in destroy, for two independent reasons:
 *
 *  1. `runtimeRemount` may be an in-flight mount operation. Tearing the environment down under it
 *     would let a remount land against half-freed state.
 *  2. The tool relay and the loopback MCP server can both have a `tools/call` in flight. Aborting
 *     them before the server closes is what stops a handler writing a result after the turn ended.
 *
 * The composer sequences this. The unit only guarantees it never throws.
 */
import { rmSync } from "node:fs";

import { configureDaytonaCodexEnv } from "../engines/sandbox_agent/codex-assets.ts";
import { buildDaemonEnv } from "../engines/sandbox_agent/daemon.ts";
import {
  buildPiExtensionEnv,
  configurePiSessionWorkspace,
  configurePiSkillSnapshot,
  resolvePiToolSpecsDelivery,
  writePiToolSpecsFileLocal,
} from "../engines/sandbox_agent/pi-assets.ts";
import { applyClaudeConnectionEnv } from "../engines/sandbox_agent/runtime-policy.ts";
import type { AgentRunRequest } from "../protocol.ts";
import { PI_TRACE_CONTROL_FILE } from "../tracing/pi-spool-protocol.ts";
import type { RunPlan } from "../engines/sandbox_agent/run-plan.ts";
import type { Log } from "./timing.ts";

/** The handles this unit tears down. All optional: a partial acquire leaves most unset. */
export interface RuntimeTeardownInput {
  /** An in-flight remount promise. Awaited first, and its failure is ignored. */
  runtimeRemount: Promise<unknown> | undefined;
  /** The current turn's tool relay, if a turn is running. */
  toolRelay: { stop: () => Promise<unknown> } | undefined;
  /** Aborts any in-flight loopback `tools/call`. */
  mcpAbort: { abort: () => void };
  /** Closes the internal gateway-tool MCP server, when one started. */
  closeToolMcp: (() => Promise<unknown>) | undefined;
}

/**
 * Quiesce everything that could still be running, in order.
 *
 * Every step swallows its own failure. Teardown must always reach the end: a throw here would
 * strand a sandbox, a mount, or both.
 */
export async function teardownInFlight(
  input: RuntimeTeardownInput,
): Promise<void> {
  await input.runtimeRemount?.catch(() => {});
  await input.toolRelay?.stop().catch(() => {});
  // Backstop: destroy any in-flight loopback `tools/call` before closing the server, so a
  // handler cannot write a result after the turn has ended.
  input.mcpAbort.abort();
  await input.closeToolMcp?.().catch(() => {});
}

/** The runner-owned paths this unit removes at teardown. */
export interface RuntimeFilesInput {
  /**
   * The per-run Agenta agent dir (skills isolation). Throwaway by construction.
   *
   * It is ALWAYS a temp dir when set: a subscription run leaves it undefined precisely so that
   * the operator's mounted login — which the harness runs out of directly — is never deleted
   * here. Deleting an operator mount would destroy a real credential.
   */
  runAgentDir: string | undefined;
  /**
   * The local off-mount Codex SQLite home. Disposable: native resume rides the `sessions/`
   * rollout files on CODEX_HOME, not the SQLite, so losing it costs nothing.
   */
  codexSqliteHome: string | undefined;
}

/**
 * Remove the runner-owned files.
 *
 * NO CODEX `auth.json` BACKSTOP, deliberately. Managed auth is file-free, so no file exists. The
 * subscription symlink is left in the runner-owned home on purpose: it points at the operator's
 * mount, it is not a secret, and it is correct for the next resume. The old managed-file backstop
 * was also ordering-buggy — it ran AFTER `unmountStorage`, so on a local durable session it
 * deleted nothing and stranded the key in the store.
 */
export function removeRuntimeFiles(input: RuntimeFilesInput): void {
  // `force: true` suppresses ENOENT and nothing else. A per-run dir under a stale FUSE node can
  // still fail with EACCES, EBUSY or ENOTCONN, and `destroy` runs this BEFORE the skills cleanup,
  // so one unlucky unlink used to leak the skills temp root and reject a teardown that promises
  // never to throw. Each removal is independent, so one failure must not skip the next.
  for (const [path, recursive] of [
    [input.runAgentDir, true],
    [input.codexSqliteHome, true],
  ] as const) {
    if (!path) continue;
    try {
      rmSync(path, { recursive, force: true });
    } catch {
      // best-effort cleanup of a runner-owned file
    }
  }
}

/**
 * ============================================================================================
 * BOOTSTRAP: building the daemon environment
 * ============================================================================================
 *
 * This is the part of `prepareEnvironmentSetup` that was never planning. It BUILDS two
 * environment maps and WRITES one file, so it belongs to the runtime rather than to the planner.
 * Moving it here is what lets `environment-setup.ts` become what its name claims.
 *
 * THE OUTPUT IS THE DAEMON'S WHOLE WORLD, and it is immutable once the provider takes it. See
 * `AcquireContext`'s invariant 1: after `buildSandboxProvider` the maps are frozen, so everything
 * the daemon will ever know has to be in place before that call.
 */
export interface BuildRuntimeEnvironmentInput {
  /**
   * The real types, not `never`.
   *
   * These were `never` with `as never` casts at the call site, which meant `tsc --strict` checked
   * nothing across this module boundary: a renamed field in `RunPlan` or `AgentRunRequest` would
   * compile on both sides and fail at run time. The structural aliases inside the function were
   * the same hole in a second place, describing a shape the compiler never compared to the source
   * of truth.
   */
  plan: RunPlan;
  request: AgentRunRequest;
  piSkillSnapshot: unknown;
  log: Log;
  deps: { buildDaemonEnv?: typeof buildDaemonEnv };
}

export interface RuntimeEnvironment {
  /** The daemon process environment. Taken BY REFERENCE by the sandbox provider. */
  env: Record<string, string>;
  /** The Pi extension environment. Also taken by reference; Daytona builds its provider from it. */
  piExtEnv: Record<string, string>;
  /** Where Pi writes native transcripts, or undefined for a non-Pi run. */
  piSessionDir: string | undefined;
}

/**
 * Build the daemon and extension environments.
 *
 * ONE ORDERING RULE INSIDE: `Object.assign(env, piExtEnv)` comes LAST. The local daemon inherits
 * the extension env that way, while Daytona receives the same values through its own `envVars`.
 * Assigning earlier would drop every key the Pi and Codex configuration adds after it.
 *
 * The stable telemetry-control PATH enters Pi's env; per-turn context rides that read-once file.
 * The OTLP endpoint and authorization remain runner-owned and never enter the daemon env.
 */
export function assignSandboxEnvironment(
  targets: Array<Record<string, string>>,
  sandboxEnvironment: Record<string, string>,
): void {
  for (const name of Object.keys(sandboxEnvironment)) {
    if (targets.some((target) => Object.prototype.hasOwnProperty.call(target, name))) {
      throw new Error(`sandboxCredentials binding  collides with runner-owned environment`);
    }
  }
  for (const target of targets) Object.assign(target, sandboxEnvironment);
}

export function buildRuntimeEnvironment(
  input: BuildRuntimeEnvironmentInput,
): RuntimeEnvironment {
  const p = input.plan;
  const r = input.request;

  // Only runtime_provided keeps the inherited keys: the harness uses its own login there.
  const clearProviderEnv =
    p.credentials.credentialMode === "env" ||
    p.credentials.credentialMode === "none";
  const env = (input.deps.buildDaemonEnv ?? buildDaemonEnv)(
    p.acpAgent as never,
    {
      clearProviderEnv,
      provider: r.modelConnection?.provider,
      deployment: r.modelConnection?.deployment,
    },
  );
  // Apply only the resolved provider keys.
  Object.assign(env, p.credentials.modelEnvironment);
  applyClaudeConnectionEnv(env, input.request, p.acpAgent as never, input.log);
  const piSessionDir = configurePiSessionWorkspace(input.plan, env);
  configurePiSkillSnapshot(input.piSkillSnapshot as never, env);

  const piExtEnv: Record<string, string> = p.isPi
    ? buildPiExtensionEnv(input.request, {
        relayDir: p.workspace.relayDir,
        usageOutPath: p.workspace.usageOutPath,
        telemetryControlPath: `${p.workspace.telemetryDir}/${PI_TRACE_CONTROL_FILE}`,
        builtinGatingActive: p.tools.builtinGatingActive,
      })
    : {};
  // The tool specs `buildPiExtensionEnv` just pointed the extension at ride a FILE (they are far
  // too large for an env string — see `piToolSpecsFilePath`). A local run writes it here, beside
  // the relay dir. A Daytona run cannot write there because the runner's filesystem is not the
  // sandbox's, so `prepareDaytonaPiAssets` uploads the same bytes to the same path instead.
  if (p.isPi && !p.isDaytona) {
    const toolSpecs = resolvePiToolSpecsDelivery(
      p.tools.toolSpecs,
      p.workspace.relayDir,
    );
    if (toolSpecs) writePiToolSpecsFileLocal(toolSpecs, input.log);
  }
  // Daytona builds its provider from `piExtEnv` rather than the local daemon env, so the
  // transcript location has to sit in BOTH slices or Pi and pi-acp disagree about the path.
  if (piSessionDir) piExtEnv.PI_CODING_AGENT_SESSION_DIR = piSessionDir;
  configurePiSkillSnapshot(input.piSkillSnapshot as never, piExtEnv);
  // Managed Daytona Codex: CODEX_HOME stays on the durable cwd (native resume rides its
  // `sessions/` rollouts) while CODEX_SQLITE_HOME points in-VM, off the mount. Set here because
  // the Daytona daemon env is fixed at sandbox creation and is built from `piExtEnv`.
  configureDaytonaCodexEnv(input.plan, piExtEnv);
  assignSandboxEnvironment([env, piExtEnv], p.credentials.sandboxEnvironment);
  // LAST, deliberately: the local daemon inherits the extension env, and Daytona gets the same
  // values through `envVars`. Assigning earlier would drop every key added above.
  Object.assign(env, piExtEnv);

  return { env, piExtEnv, piSessionDir };
}
