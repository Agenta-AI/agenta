/**
 * sandbox-agent harness driver.
 *
 * Drives a coding harness (Pi, Claude Code, ...) over the Agent Client Protocol (ACP)
 * through the `sandbox-agent` daemon, instead of the bespoke Pi SDK calls in the pi
 * engine. It serves the same /run contract (AgentRunRequest -> AgentRunResult), so the
 * Python side stays thin and the choice of harness/sandbox is config, not new code.
 *
 * Per invoke (cold), mirroring the shipped code-evaluator DaytonaRunner pattern:
 *
 *   SandboxAgent.start({ sandbox: local({ env }) | daytona({ create }) })
 *     -> createSession({ agent: <harness>, cwd, model })
 *       -> write AGENTS.md into cwd
 *       -> session.prompt([{ type: "text", text }])
 *         -> accumulate ACP `agent_message_chunk` text + build the trace
 *           -> destroySandbox()
 *
 * Two orthogonal axes swap independently: the sandbox (where the daemon runs) and the
 * harness (which engine). The ACP boundary is daemon-to-harness; the service-to-sandbox-agent
 * hop stays harness-agnostic behind the Harness port.
 *
 * Session keep-alive (flag-gated, off by default) splits the per-invoke work into
 * `acquireEnvironment` (session-scoped: sandbox, mount, session, MCP wiring) and `runTurn`
 * (per-turn: otel run, prompt, usage, trace). `runSandboxAgent` composes them exactly as
 * before (acquire -> runTurn -> destroy), so with the flag off behavior is byte-identical.
 * The dispatch in `server.ts` reuses the two halves to continue a live session across a turn
 * boundary. See docs/design/agent-workflows/projects/session-keepalive/plan.md.
 *
 * Tracing is built here from the ACP event stream (see tracing/otel.ts createSandboxAgentOtel),
 * so it is uniform across every harness and always nests under the caller's /invoke
 * span. stdout is reserved for the JSON result (see cli.ts); logs go to stderr.
 */
import { mkdirSync, rmSync } from "node:fs";

import { apiBase } from "../../apiBase.ts";

import {
  InMemorySessionPersistDriver,
  SandboxAgent,
  type SessionEvent,
  type SessionPermissionRequest,
} from "sandbox-agent";

import {
  resolveRunSessionId,
  type AgentRunRequest,
} from "../../protocol.ts";
import { type ClientToolOutcome } from "../../responder.ts";
import type { ClientToolRelay } from "../../tools/client-tool-relay.ts";
import { advertisedToolSpecs } from "../../tools/public-spec.ts";
import { createAcpFetch } from "./acp-fetch.ts";
import {
  assert,
  assertRequiredCapabilities,
  probeCapabilities,
} from "./capabilities.ts";
import { createToolCallCorrelationIndex } from "./client-tools.ts";
import { buildDaemonEnv, resolveDaemonBinary } from "./daemon.ts";
import { DaytonaReconnectTerminalError } from "./daytona-provider.ts";
import {
  createCookieFetch,
  DAYTONA_PI_DIR,
  prepareDaytonaPiAssets,
} from "./daytona.ts";
import { conciseError } from "./errors.ts";
import { buildSessionMcpServers } from "./mcp.ts";
import { applyModel } from "./model.ts";
import {
  discoverTunnelEndpoint,
  harnessSessionMounts,
  mountHarnessSessionDirs,
  mountStorage,
  mountStorageRemote,
  signSessionMountCredentials,
  storeReachableFromSandbox,
  unmountStorage,
  type MountCredentials,
} from "./mount.ts";
import {
  buildPiExtensionEnv,
  configurePiSessionWorkspace,
  configurePiSkillSnapshot,
  PI_PERMISSION_EXTENSION_UNAVAILABLE_MESSAGE,
  prepareLocalPiAssets,
  resolvePiSkillSnapshot,
  uploadSystemPromptToSandbox,
  writeSystemPromptLocal,
  writeOtlpAuthFile,
} from "./pi-assets.ts";
import {
  AGENT_MOUNT_ENV_VAR,
  agentMountPath,
  linkAgentFiles,
  linkAgentFilesRemote,
  seedAgentReadme,
  seedAgentReadmeRemote,
  signAgentMountCredentials,
} from "./agent-mount.ts";
import {
  AGENT_MOUNT_SYSTEM_PROMPT_SEGMENT,
  claudeMountSystemPromptMeta,
  combineAppendSystemPrompt,
  type ClaudeSystemPromptMeta,
} from "./agent-mount-guidance.ts";
import {
  routePermissionRequestToActiveTurn,
  routeSessionEventToActiveTurn,
} from "./session-events.ts";
import { loadRunnerConfig } from "../../config/runner-config.ts";
import { buildSandboxProvider } from "./provider.ts";
import { buildRunPlan } from "./run-plan.ts";
import {
  clearSandboxPointer,
  readStoredSandboxPointer,
  writeSandboxPointer,
} from "./sandbox-reconnect.ts";
import type {
  AcquireEnvironmentResult,
  SandboxAgentDeps,
  SessionEnvironment,
} from "./runtime-contracts.ts";
import {
  applyClaudeConnectionEnv,
  containsTransportEndpointDisconnected,
  defaultResolveLocalRunnerOwner,
  isTransportEndpointDisconnected,
  modelResolutionStrict,
  runCredential,
} from "./runtime-policy.ts";
import { hydrateHarnessSessionFromDurable } from "./session-continuity-durable.ts";
import {
  assertLocalRunnerOwnership,
  eligibleAgentSessionId,
  nextTurnIndex,
  sessionContinuityStore,
} from "./session-continuity.ts";
import {
  projectScopeFor,
  resolvesToLocalProvider,
} from "./session-identity.ts";
import {
  teardownDisposition,
  type TeardownReason,
} from "./teardown.ts";
import {
  uploadToolMcpAssets,
  type ToolMcpAssets,
} from "./tool-mcp-assets.ts";
import { prepareWorkspace } from "./workspace.ts";

function log(message: string): void {
  process.stderr.write(`[sandbox-agent] ${message}\n`);
}

type Log = (message: string) => void;

const LOCAL_DURABLE_CWD_ENOTCONN_REMOUNT_LIMIT = 1;

// In-flight sandbox handles, by run. A process KILL (docker stop / SIGTERM / OOM mid-run) skips
// the per-run teardown — so a shutdown signal handler (see `server.ts`) drains this set to
// best-effort delete any still-running sandbox before exit. Remote (Daytona) sandboxes that even a
// signal can never reach (SIGKILL/OOM) self-reap via the lifecycle reapers in `provider.ts`.
const inFlightSandboxes = new Set<{
  destroy: (opts?: { reason?: TeardownReason }) => Promise<void>;
  sessionId: string;
  mountProjectId?: string;
  projectScopeId?: string;
}>();

/**
 * Best-effort delete every sandbox currently mid-run, bounded so it can never hang shutdown.
 * Called from the process signal handler so `docker stop` reaps remote sandboxes instead of
 * leaking them. Each delete is independent and its own failure is swallowed; the whole sweep is
 * raced against `timeoutMs` so a slow Daytona API call cannot block the exit.
 */
export async function destroyInFlightSandboxes(
  timeoutMs = 5000,
  reason: TeardownReason = "shutdown-in-flight",
): Promise<void> {
  const pending = [...inFlightSandboxes];
  if (pending.length === 0) return;
  const sweep = Promise.allSettled(
    pending.map((environment) =>
      Promise.resolve(environment.destroy({ reason })).catch(() => {}),
    ),
  );
  await Promise.race([
    sweep,
    new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
  ]);
}

/**
 * Same drain as `destroyInFlightSandboxes`, scoped to one session (and, when supplied, its
 * owning project). Backs the HTTP `/kill` route so a caller can only tear down its own
 * session's in-flight sandbox(es) — the unscoped sweep above stays an in-process-only call
 * (the shutdown handler).
 *
 * Filters on `projectScopeId` (same run-context-preferred, mount-fallback precedence as
 * `poolKeyFor`/`projectScopeFor` — never `mountProjectId` alone, which is undefined for a
 * mountless run and would make a scoped kill silently match nothing). A sandbox whose run had
 * no project scope at all (`projectScopeId` undefined) never matches a scoped `projectId`
 * filter: `/kill` requires a non-blank `projectId`, so there is no caller this in-flight entry
 * could ever be proven to belong to — the same no-scope-no-park invariant the pool enforces,
 * mirrored here as no-scope-no-scoped-kill. It still falls to the unscoped shutdown sweep.
 */
export async function destroyInFlightSandboxesForSession(
  sessionId: string,
  projectId: string | undefined,
  timeoutMs = 5000,
  reason: TeardownReason = "kill",
): Promise<void> {
  const pending = [...inFlightSandboxes].filter(
    (environment) =>
      environment.sessionId === sessionId &&
      (!projectId || environment.projectScopeId === projectId),
  );
  if (pending.length === 0) return;
  const sweep = Promise.allSettled(
    pending.map((environment) =>
      Promise.resolve(environment.destroy({ reason })).catch(() => {}),
    ),
  );
  await Promise.race([
    sweep,
    new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
  ]);
}

/**
 * Sign the session's durable mount up front so keep-alive can build a pool key (the mount's
 * owning `projectId`, the FALLBACK project scope when the run carries no service-stamped
 * `runContext.project.id`) and credential epoch without acquiring the whole environment. Returns
 * exactly what the sign yielded: `null` when there is no session/credential to sign with, or
 * the sign returned no usable mount (store unconfigured, 503, ephemeral fallback). The caller
 * threads the result — null included — into `acquireEnvironment` as `presignedMount`, so the
 * mount is signed exactly once per run on every path. A null result no longer forces a cold run
 * on its own: the request still parks when the run context supplied a project scope, and only
 * skips parking when NEITHER source yields one (`poolKeyFor` returns null).
 */
export async function resolveKeepaliveMount(
  request: AgentRunRequest,
  deps: SandboxAgentDeps = {},
): Promise<MountCredentials | null> {
  const logger = deps.log ?? log;
  const sessionForMount = request.sessionId?.trim();
  const runCred = runCredential(request);
  if (!sessionForMount || !runCred) return null;
  const signMount =
    deps.signSessionMountCredentials ?? signSessionMountCredentials;
  return signMount(sessionForMount, {
    apiBase: apiBase(),
    authorization: runCred,
    log: logger,
  });
}

/**
 * Build the session-scoped environment: sign the mount, build the run plan, start the sandbox,
 * mount the durable cwd, prepare the workspace, probe capabilities, wire the internal tool-MCP
 * server, and open the ACP session. Session-lifetime `onEvent`/`onPermissionRequest` listeners
 * are attached once here and demux into `env.currentTurn`.
 *
 * Finalizers register incrementally on `env` as each resource is acquired; a mid-acquire failure
 * runs `env.destroy()` (which null-checks every resource, so a half-built environment cannot
 * leak) and returns `{ ok: false }`, mirroring today's shared teardown. When `presignedMount` is
 * supplied (the keep-alive cold path already signed to build the pool key) the initial sign is
 * skipped so the mount is signed once per run.
 */
export async function acquireEnvironment(
  request: AgentRunRequest,
  deps: SandboxAgentDeps = {},
  signal?: AbortSignal,
  presignedMount?: MountCredentials | null,
): Promise<AcquireEnvironmentResult> {
  const logger = deps.log ?? log;
  const acquireStartedAt = Date.now();
  const timingLog = (stage: string, startedAt: number, fields = ""): void => {
    const sandboxId = environment?.sandbox?.sandboxId ?? "-";
    const sessionId =
      environment?.sessionId ?? request.sessionId?.trim() ?? "-";
    logger(
      `[timing] stage=${stage} ms=${Math.round(Date.now() - startedAt)} sandbox=${sandboxId} session=${sessionId}${fields}`,
    );
  };

  // Local multi-runner fails loudly. Session-owned + local-sandbox only (a non-session run
  // has no cross-replica identity to protect, and a remote sandbox has no runner-local pooled
  // state to protect it FROM). The resolver claims the `owner` affinity key and reads the actual
  // owner back; a KNOWN different owner throws (never a silent wrong-host cold start).
  const continuitySessionForOwnership = request.sessionId?.trim();
  if (
    continuitySessionForOwnership &&
    resolvesToLocalProvider(request.sandbox)
  ) {
    const { replicaId, ownerReplicaId } = await (
      deps.resolveLocalRunnerOwner ?? defaultResolveLocalRunnerOwner
    )(continuitySessionForOwnership, runCredential(request));
    try {
      assertLocalRunnerOwnership(
        continuitySessionForOwnership,
        replicaId,
        ownerReplicaId,
      );
    } catch (err) {
      return { ok: false, error: conciseError(err, request.harness ?? "") };
    }
  }

  // Sign BEFORE buildRunPlan so the prefix is available for the durable cwd derivation.
  // Inputs (sessionId, apiBase, credential) are independent of the plan. Best-effort: null on
  // failure leaves durableCwd undefined and buildRunPlan falls back to the ephemeral path.
  const sessionForMount = request.sessionId?.trim();
  const runCred = runCredential(request);
  const signMount =
    deps.signSessionMountCredentials ?? signSessionMountCredentials;
  let mountCreds: MountCredentials | null =
    presignedMount !== undefined
      ? presignedMount
      : sessionForMount && runCred
        ? await signMount(sessionForMount, {
            apiBase: apiBase(),
            authorization: runCred,
            log: logger,
          })
        : null;
  // A session-owned run expects a durable session cwd mount. When signing returns nothing the run
  // still proceeds on an ephemeral cwd (behavior unchanged, RSH-11); emit one structured warning
  // keyed by mount kind so durable-to-ephemeral degradation is measurable, not silent.
  if (sessionForMount && !mountCreds) {
    logger(
      `mount degraded kind=session_cwd cause=sign_returned_no_mount session=${sessionForMount}`,
    );
  }

  const artifactId = request.runContext?.workflow?.artifact?.id?.trim();
  const signAgentMount =
    deps.signAgentMountCredentials ?? signAgentMountCredentials;
  const agentMountCreds: MountCredentials | null =
    artifactId && runCred
      ? await signAgentMount(artifactId, {
          apiBase: apiBase(),
          authorization: runCred,
          log: logger,
        })
      : null;
  // A workflow-artifact run expects an agent mount; same structured degrade signal when unsigned.
  if (artifactId && !agentMountCreds) {
    logger(
      `mount degraded kind=agent_mount cause=sign_returned_no_mount artifact=${artifactId}`,
    );
  }
  // Derive the durable cwd from the sign prefix (one source of truth, both providers).
  // local: /tmp/agenta/<prefix>  —  daytona: /home/sandbox/agenta/<prefix>
  // <prefix> is already "mounts/<project_id>/<mount_id>", so no extra slug is needed.
  let durableCwd: string | undefined;
  if (mountCreds?.prefix) {
    const isDaytonaReq =
      (request.sandbox ?? loadRunnerConfig().providers.default) === "daytona";
    durableCwd = isDaytonaReq
      ? `/home/sandbox/agenta/${mountCreds.prefix}`
      : `/tmp/agenta/${mountCreds.prefix}`;
  }

  const planResult = buildRunPlan(request, {
    sandboxProvider: deps.sandboxProvider,
    createLocalCwd: deps.createLocalCwd,
    createDaytonaCwd: deps.createDaytonaCwd,
    durableCwd,
    resolveSkillDirs: deps.resolveSkillDirs,
    log: logger,
  });
  if (!planResult.ok) return { ok: false, error: planResult.error };
  const plan = planResult.plan;
  const piSkillSnapshot = resolvePiSkillSnapshot(plan);
  const agentMountDir = agentMountCreds ? agentMountPath(plan.cwd) : undefined;

  // Clear-then-apply (Security rule 5): on a managed run (credentialMode "env") the daemon
  // inherits NONE of the sidecar's own provider keys, so only the resolved `plan.secrets` are
  // present and an inherited key for another provider cannot leak. For runtime_provided/none/
  // un-migrated runs the harness uses its own login, so the inherited keys stay.
  const clearProviderEnv = plan.credentialMode === "env";
  const env = (deps.buildDaemonEnv ?? buildDaemonEnv)(plan.acpAgent, {
    clearProviderEnv,
    provider: request.provider,
    deployment: request.deployment,
  });
  Object.assign(env, plan.secrets); // apply only the resolved provider keys
  applyClaudeConnectionEnv(env, request, plan.acpAgent, logger);
  const piSessionDir = configurePiSessionWorkspace(plan, env);
  configurePiSkillSnapshot(piSkillSnapshot, env);
  const strictModel = modelResolutionStrict();
  // Pi self-instruments locally: propagate the trace context + public tool metadata into Pi
  // via the Agenta extension. Tool execution always relays back to this runner, which keeps
  // private specs, scoped env, callback endpoints, and callback auth in memory.
  // local Pi's OTLP bearer rides a runner-written 0600 file, never a plain env var —
  // Daytona never receives telemetry env here at all (`!plan.isDaytona` gates it off above).
  const otlpAuthFilePath =
    plan.isPi && !plan.isDaytona ? `${plan.relayDir}.otlp-auth` : undefined;
  const otlpAuthorization =
    request.telemetry?.exporters?.otlp?.headers?.authorization;
  if (otlpAuthFilePath && otlpAuthorization) {
    writeOtlpAuthFile(otlpAuthFilePath, otlpAuthorization, logger);
  }
  const piExtEnv = plan.isPi
    ? buildPiExtensionEnv(request, !plan.isDaytona, {
        relayDir: plan.relayDir,
        usageOutPath: plan.usageOutPath,
        otlpAuthFilePath,
        builtinGatingActive: plan.builtinGatingActive,
        builtinGrants: plan.builtinGrants,
        // The materialized skill names (author + forced `_agenta.*`) so Pi's own agent span
        // records which skills loaded; local Pi self-instruments, so the runner's sandbox-agent
        // otel has no span to stamp here.
        skills: plan.skillDirs.map((s) => s.name),
      })
    : {};
  // Daytona's provider is built from `piExtEnv` rather than the local daemon env. Keep the
  // transcript location in both environment slices so Pi and pi-acp see the same durable path
  // regardless of provider.
  if (piSessionDir) piExtEnv.PI_CODING_AGENT_SESSION_DIR = piSessionDir;
  configurePiSkillSnapshot(piSkillSnapshot, piExtEnv);
  Object.assign(env, piExtEnv); // local daemon inherits it; daytona gets it via envVars
  logger(
    `tools=${plan.toolSpecs.length} executableTools=${plan.executableToolSpecs.length} ` +
      `piPublicTools=${piExtEnv.AGENTA_AGENT_TOOLS_PUBLIC_SPECS ? "yes" : "no"}`,
  );
  if (!plan.isPi && plan.isDaytona) {
    const omittedClientTools = plan.toolSpecs
      .filter((spec) => spec.kind === "client")
      .map((spec) => spec.name);
    if (omittedClientTools.length > 0) {
      logger(
        `omitting client tools from Daytona stdio MCP shim: ${omittedClientTools.join(", ")}`,
      );
    }
  }
  // undefined is fine: the local provider runs its own resolution and errors clearly.
  const binaryPath = (deps.resolveDaemonBinary ?? resolveDaemonBinary)();
  const localPiAssets = prepareLocalPiAssets({ plan, env, log: logger });
  let runAgentDir = localPiAssets.dir;
  // Fail closed (Decision 2): when the policy could gate a Pi built-in tool but the permission
  // extension did not install, the run must stop rather than run those tools unprotected. Recorded
  // here (the install ran above) and thrown inside the try below so the engine's own catch turns it
  // into `{ ok: false, error }` and a visible error frame. `builtinGatingActive` false means
  // allow-everything, where the extension is not needed and a failed install is harmless.
  const localBuiltinGatingUnenforceable =
    plan.isPi &&
    !plan.isDaytona &&
    plan.builtinGatingActive &&
    !localPiAssets.extensionInstalled;

  // A local Claude subscription run reads and writes the operator's read-write mounted login
  // DIRECTLY: `buildDaemonEnv` already carried `CLAUDE_CONFIG_DIR` (the mount) into the daemon env,
  // and there is deliberately no per-run copy. Claude refreshes its OAuth token mid-run and writes
  // it back to its config dir; copying that dir per run would discard the refresh, so the next run
  // would fail as soon as the provider rotated the refresh token. The harness owns its own token
  // lifecycle, exactly like a normal local install (interface.md section 6). buildRunPlan already
  // rejected a runtime_provided Claude run with no configured CLAUDE_CONFIG_DIR.

  logger(`harness=${plan.harness} sandbox=${plan.sandboxId} cwd=${plan.cwd}`);

  // The resolved model ref as it reaches the runner (key NAMES only, never values) — the one
  // line that answers "what model/provider/deployment/credential did this run actually use".
  logger(
    `resolved model=${request.model ?? "<none>"} provider=${request.provider ?? "<none>"} ` +
      `deployment=${request.deployment ?? "<none>"} ` +
      `connection=${request.connection ? `${request.connection.mode}:${request.connection.slug ?? "-"}` : "<none>"} ` +
      `secretKeys=[${Object.keys(request.secrets ?? {}).join(",")}]`,
  );

  // The shared client-tool relay reference (the deferred ref baked into the MCP server reads it;
  // each turn's `runTurn` sets `.current`). A `tools/call` can only arrive during a prompt —
  // long after the relay is wired — so the server captures this reference and it resolves to the
  // real relay before any call lands.
  const clientToolRelayRef: { current?: ClientToolRelay } = {};
  const deferredClientToolRelay: ClientToolRelay = {
    onClientTool: (req) =>
      clientToolRelayRef.current
        ? clientToolRelayRef.current.onClientTool(req)
        : Promise.resolve("deny" as ClientToolOutcome),
    onPause: (req) => clientToolRelayRef.current?.onPause?.(req),
  };

  // Aborts any in-flight loopback `tools/call` (a paused Claude client tool) on pause/teardown,
  // so its handler is torn down deterministically and cannot write a result after the turn ends.
  const mcpAbort = new AbortController();

  const environment: SessionEnvironment = {
    plan,
    logger,
    deps,
    sandbox: undefined,
    session: undefined,
    sessionId: resolveRunSessionId(request, ""),
    model: undefined,
    capabilities: {},
    strictModel,
    toolCallIndex: createToolCallCorrelationIndex(),
    clientToolRelayRef,
    mcpAbort,
    runAgentDir,
    otlpAuthFilePath,
    mountCreds,
    agentMountCreds,
    mountProjectId: mountCreds?.projectId,
    projectScopeId: projectScopeFor(request, mountCreds?.projectId)?.id,
    loadedFromContinuity: false,
    resumable: false,
    continuityTurnIndex: undefined,
    sessionDestroyRequested: false,
    mountedCwd: undefined,
    agentMountedPath: undefined,
    durableCwdSafeToDelete: true,
    // Local runs get a plain rmSync cleanup for the throwaway cwd; Daytona has none on this host.
    workspace: plan.isDaytona
      ? undefined
      : {
          cleanup: async () =>
            rmSync(plan.cwd, { recursive: true, force: true }),
        },
    runtimeRemount: undefined,
    closeToolMcp: undefined,
    currentTurn: undefined,
    lastTurnToolCallIds: [],
    parkedApproval: undefined,
    approvalGateCount: 0,
    destroyed: false,
    destroy: async () => {},
    clearTurn: () => {},
  };

  environment.clearTurn = () => {
    environment.currentTurn = undefined;
  };

  // The one complete, idempotent teardown — the same steps the old per-run `finally` ran, in the
  // same order. Every resource is null-checked, so it is safe after a partial acquire and safe to
  // call twice (the guard returns on a second call). It must never throw.
  environment.destroy = async (opts?: { reason?: TeardownReason }) => {
    if (environment.destroyed) return;
    environment.destroyed = true;
    await environment.runtimeRemount?.catch(() => {});
    inFlightSandboxes.delete(environment);
    await environment.currentTurn?.toolRelay?.stop().catch(() => {});
    // Teardown backstop: destroy any in-flight loopback `tools/call` before closing the server.
    environment.mcpAbort.abort();
    await environment.closeToolMcp?.().catch(() => {});
    // Graceful `session/cancel` BEFORE tearing down the daemon, or the ACP adapter subprocess
    // reparents to PID 1 and never exits. Skip if the pause path already sent it.
    if (environment.session && !environment.sessionDestroyRequested)
      await environment.sandbox
        ?.destroySession?.(environment.session.id)
        .catch(() => {});
    const disposition = teardownDisposition(opts?.reason ?? "failed-turn");
    let parked = false;
    if (
      disposition === "stop" &&
      plan.isDaytona &&
      environment.sandbox?.pauseSandbox
    ) {
      const sandboxLogId = environment.sandbox.sandboxId ?? plan.sandboxId;
      try {
        await environment.sandbox.pauseSandbox();
        parked = true;
        logger(`parked sandbox=${sandboxLogId}`);
      } catch (err) {
        logger(
          `pause failed sandbox=${sandboxLogId}: ${conciseError(err, plan.harness)}`,
        );
      }
    }
    if (!parked) await environment.sandbox?.destroySandbox().catch(() => {});
    await environment.sandbox?.dispose().catch(() => {});
    // Unmount the durable cwd BEFORE removing the dir: data lives in the store, only the host
    // mountpoint is torn down. If unmount is not CONFIRMED gone, skip the delete: rmSync must
    // never run against a possibly-live FUSE mount into the durable store.
    if (environment.mountedCwd) {
      environment.durableCwdSafeToDelete = await (
        environment.deps.unmountStorage ?? unmountStorage
      )(environment.mountedCwd, { log }).catch(() => false);
    }
    if (!parked && !plan.isDaytona && environment.agentMountedPath) {
      const agentMountSafeToDelete = await (
        environment.deps.unmountStorage ?? unmountStorage
      )(environment.agentMountedPath, { log }).catch(() => false);
      if (agentMountSafeToDelete) {
        try {
          rmSync(environment.agentMountedPath, {
            recursive: true,
            force: true,
          });
        } catch (err) {
          logger(
            `agent mountpoint cleanup failed path=${environment.agentMountedPath}: ${conciseError(err, plan.harness)}`,
          );
        }
      }
    }
    if (!environment.durableCwdSafeToDelete) {
      logger(
        `durable cwd unmount not confirmed, skipping workspace cleanup cwd=${plan.cwd}`,
      );
    } else {
      await environment.workspace?.cleanup().catch(() => {});
    }
    // The per-run Agenta agent dir (skills isolation) is throwaway; remove it too. This is only
    // ever a temp dir: a subscription run leaves `runAgentDir` undefined precisely so that the
    // operator's mounted login (which the harness runs out of directly) is never deleted here.
    if (environment.runAgentDir)
      rmSync(environment.runAgentDir, { recursive: true, force: true });
    // Backstop: the extension deletes this on read; remove it here too in case the harness never
    // started (or crashed before reading it), so the bearer never lingers.
    if (environment.otlpAuthFilePath)
      rmSync(environment.otlpAuthFilePath, { force: true });
    // Remove the per-run skills temp root the materializer created (success or error).
    plan.skillsCleanup();
  };

  let agentMountGuidanceActive = false;
  const activateAgentMountGuidance = async (): Promise<void> => {
    const mountedPath = environment.agentMountedPath;
    if (!mountedPath || agentMountGuidanceActive) return;
    agentMountGuidanceActive = true;

    // Only advertise durable storage after the mount is confirmed active. Local daemon env is
    // still mutable here because local mounts run before SandboxAgent.start below. Daytona cannot
    // change daemon env after sandbox creation, so its harness discovers the mount through the
    // post-mount system-prompt channel and the cwd-local agent-files symlink instead.
    if (!plan.isDaytona) {
      env[AGENT_MOUNT_ENV_VAR] = mountedPath;
      piExtEnv[AGENT_MOUNT_ENV_VAR] = mountedPath;
    }
    if (!plan.isPi) return;

    plan.appendSystemPrompt = combineAppendSystemPrompt(
      plan.appendSystemPrompt,
      AGENT_MOUNT_SYSTEM_PROMPT_SEGMENT,
    );
    plan.hasSystemPrompt = true;
    if (plan.isDaytona) {
      await uploadSystemPromptToSandbox(
        environment.sandbox,
        DAYTONA_PI_DIR,
        plan.systemPrompt,
        plan.appendSystemPrompt,
        logger,
      );
      return;
    }
    if (environment.runAgentDir) {
      writeSystemPromptLocal(
        environment.runAgentDir,
        plan.systemPrompt,
        plan.appendSystemPrompt,
        logger,
      );
      return;
    }
    // Discarding `.extensionInstalled` here is safe, and a fail-closed throw here would be
    // unsound anyway (both callers wrap this in a mount try/catch that logs and continues, so a
    // throw could not stop the run). Reachability: managed/none local Pi runs always created a
    // throwaway dir in the first prepareLocalPiAssets call, so `environment.runAgentDir` is set
    // for them and they returned above — only the subscription (runtime_provided) path reaches
    // this re-prep. That path installs into the SAME operator mount the first call already
    // installed into, and the fail-closed gating check right after that first call stopped the
    // run when the install was required but failed. So by the time this runs, either enforcement
    // is not needed (policy allows everything) or the extension file is already on disk from the
    // verified first install; a transient failure here cannot remove it.
    runAgentDir = prepareLocalPiAssets({ plan, env, log: logger }).dir;
    environment.runAgentDir = runAgentDir;
  };

  // --- local durable cwd mount helpers (session-scoped, close over environment) ------ //
  const mountLocalDurableCwd = async (reason: string): Promise<boolean> => {
    if (!environment.mountCreds || plan.isDaytona) return false;
    logger(
      `local durable cwd mount (${reason}) session=${sessionForMount} cwd=${plan.cwd}`,
    );
    environment.durableCwdSafeToDelete = false;
    const mounted = await (deps.mountStorage ?? mountStorage)(
      plan.cwd,
      environment.mountCreds,
      {
        log: logger,
      },
    );
    if (mounted) {
      environment.mountedCwd = plan.cwd;
      return true;
    }
    // A false result means mountStorage stopped the attempt and confirmed the path detached.
    environment.durableCwdSafeToDelete = true;
    return false;
  };
  const mountLocalAgentCwd = async (): Promise<boolean> => {
    if (!environment.agentMountCreds || plan.isDaytona) return false;
    const mountPath = agentMountPath(plan.cwd);
    if (environment.agentMountedPath === mountPath) return true;
    try {
      mkdirSync(mountPath, { recursive: true });
      if (
        !(await (deps.mountStorage ?? mountStorage)(
          mountPath,
          environment.agentMountCreds,
          { log: logger },
        ))
      ) {
        // false means mountStorage confirmed detach is safe. This path is a sibling of the
        // session cwd, so workspace cleanup cannot remove the failed mountpoint stub.
        rmSync(mountPath, { recursive: true, force: true });
        return false;
      }
      environment.agentMountedPath = mountPath;
      await seedAgentReadme(mountPath, { log: logger });
      await linkAgentFiles(plan.cwd, mountPath, { log: logger });
      await activateAgentMountGuidance();
      return true;
    } catch (err) {
      logger(
        `local agent mount failed artifact=${artifactId}: ${conciseError(err, plan.harness)}`,
      );
      return false;
    }
  };
  let localAgentMountEnotconnRemounts = 0;
  const reSignAndRemountLocalAgentMount = async (): Promise<boolean> => {
    if (!artifactId || !runCred || plan.isDaytona) return false;
    if (
      localAgentMountEnotconnRemounts >=
      LOCAL_DURABLE_CWD_ENOTCONN_REMOUNT_LIMIT
    ) {
      logger(
        `local agent mount ENOTCONN remount limit reached artifact=${artifactId} path=${agentMountPath(plan.cwd)}`,
      );
      return false;
    }
    localAgentMountEnotconnRemounts += 1;
    logger(
      `local agent mount ENOTCONN artifact=${artifactId}; re-signing and remounting`,
    );
    const fresh = await signAgentMount(artifactId, {
      apiBase: apiBase(),
      authorization: runCred,
      log: logger,
    });
    if (!fresh) {
      logger(
        `local agent mount re-sign returned no credentials artifact=${artifactId}`,
      );
      return false;
    }
    environment.agentMountCreds = fresh;
    // Clear the marker so mountLocalAgentCwd remounts instead of short-circuiting.
    environment.agentMountedPath = undefined;
    return mountLocalAgentCwd();
  };
  let localDurableCwdEnotconnRemounts = 0;
  const reSignAndRemountLocalCwd = async (): Promise<boolean> => {
    if (!sessionForMount || !runCred || plan.isDaytona) return false;
    if (
      localDurableCwdEnotconnRemounts >=
      LOCAL_DURABLE_CWD_ENOTCONN_REMOUNT_LIMIT
    ) {
      logger(
        `local durable cwd ENOTCONN remount limit reached session=${sessionForMount} cwd=${plan.cwd}`,
      );
      return false;
    }
    localDurableCwdEnotconnRemounts += 1;
    logger(
      `local durable cwd ENOTCONN session=${sessionForMount} cwd=${plan.cwd}; re-signing and remounting`,
    );
    const fresh = await signMount(sessionForMount, {
      apiBase: apiBase(),
      authorization: runCred,
      log: logger,
    });
    if (!fresh) {
      logger(
        `local durable cwd re-sign returned no credentials session=${sessionForMount}`,
      );
      return false;
    }
    environment.mountCreds = fresh;
    return mountLocalDurableCwd("enotconn-retry");
  };
  const remountLocalCwdAfterRuntimeEnotconn = (event: unknown): void => {
    if (plan.isDaytona) return;
    // The event cannot say which mount broke; remount every eligible one (alive mounts no-op).
    const cwdEligible = !!environment.mountCreds && !!environment.mountedCwd;
    const agentEligible =
      !!environment.agentMountCreds && !!environment.agentMountedPath;
    if (!cwdEligible && !agentEligible) return;
    if (
      environment.runtimeRemount ||
      !containsTransportEndpointDisconnected(event)
    )
      return;
    logger(
      `local durable mount ENOTCONN observed in ACP event session=${sessionForMount} cwd=${plan.cwd}; re-signing and remounting`,
    );
    environment.runtimeRemount = (async () => {
      const cwdOk = cwdEligible ? await reSignAndRemountLocalCwd() : true;
      const agentOk = agentEligible
        ? await reSignAndRemountLocalAgentMount()
        : true;
      return cwdOk && agentOk;
    })().catch((err) => {
      logger(
        `local durable mount runtime remount failed session=${sessionForMount}: ${conciseError(err, plan.harness)}`,
      );
      return false;
    });
  };

  try {
    // Fail closed before any sandbox/mount infra spins up: a local Pi run whose policy could gate a
    // built-in tool cannot proceed without the permission extension installed (Decision 2).
    if (localBuiltinGatingUnenforceable) {
      throw new Error(PI_PERMISSION_EXTENSION_UNAVAILABLE_MESSAGE);
    }
    // Persist events in-process so a follow-up turn can resume by session id.
    const persist =
      deps.createPersist?.() ?? new InMemorySessionPersistDriver();
    const startSandboxAgent =
      deps.startSandboxAgent ??
      ((options: Parameters<typeof SandboxAgent.start>[0]) =>
        SandboxAgent.start(options));
    // Local geesefs runs on the host, so mount before spawning the daemon. This lets the
    // mount-success path add guidance/env atomically, while a failed mount starts a normal
    // scratch-only harness with no false durable-storage signal.
    if (environment.mountCreds && !plan.isDaytona) {
      await mountLocalDurableCwd("initial");
    }
    if (environment.agentMountCreds && !plan.isDaytona) {
      await mountLocalAgentCwd();
    }
    const sandboxProvider = (deps.buildSandboxProvider ?? buildSandboxProvider)(
      plan.sandboxId,
      env,
      binaryPath,
      piExtEnv,
      plan.secrets,
      plan.sandboxPermission,
    );
    const startOptions = {
      sandbox: sandboxProvider,
      persist,
      // Propagate caller cancellation (a client disconnect on the streaming HTTP edge) so an
      // in-flight run aborts instead of finishing unobserved. `destroy` still disposes.
      ...(signal ? { signal } : {}),
      // Long-timeout undici dispatcher so a paused HITL turn is not reaped by undici's default
      // headersTimeout; Daytona additionally carries the per-sandbox auth cookie.
      fetch: plan.isDaytona
        ? (deps.createCookieFetch ?? createCookieFetch)()
        : (deps.createAcpFetch ?? createAcpFetch)(),
    };
    // A stored sandbox id is trusted: reconnect it by id and let reconnect converge its network
    // policy to this run's plan. Any reconnect failure falls through to a fresh create. Snapshot
    // and image drift are accepted as per-conversation version pinning, not grounds for a rebuild.
    const storedSandboxPointer =
      plan.isDaytona && sessionForMount && runCred
        ? await (deps.readStoredSandboxPointer ?? readStoredSandboxPointer)(
            sessionForMount,
            { authorization: runCred, log: logger },
          )
        : undefined;
    if (storedSandboxPointer) {
      const sandboxStartStartedAt = Date.now();
      try {
        environment.sandbox = await startSandboxAgent({
          ...startOptions,
          sandboxId: storedSandboxPointer.sandboxId,
        });
        logger(
          `reconnected sandbox=${storedSandboxPointer.sandboxId} session=${sessionForMount}`,
        );
      } catch (err) {
        logger(
          `reconnect failed sandbox=${storedSandboxPointer.sandboxId}, creating fresh: ${conciseError(err, plan.harness)}`,
        );
        if (
          err instanceof DaytonaReconnectTerminalError &&
          sessionForMount &&
          runCred
        ) {
          // The post-hydrate write later in acquire is authoritative. This clear only prevents
          // repeated doomed reconnects if acquire fails before reaching that write. Hydrate
          // first: after a runner restart the in-memory store is behind the durable
          // latest_turn_index, and an unhydrated guard token would be rejected as stale.
          await (
            deps.hydrateHarnessSessionFromDurable ??
            hydrateHarnessSessionFromDurable
          )(
            sessionForMount,
            plan.harness,
            deps.sessionContinuityStore ?? sessionContinuityStore,
            { authorization: runCred, log: logger },
          );
          await (deps.clearSandboxPointer ?? clearSandboxPointer)(
            sessionForMount,
            nextTurnIndex(
              sessionForMount,
              deps.sessionContinuityStore ?? sessionContinuityStore,
            ),
            { authorization: runCred, log: logger },
          );
        }
      } finally {
        timingLog("sandbox_start", sandboxStartStartedAt, " mode=reconnect");
      }
    }
    if (!environment.sandbox) {
      const sandboxStartStartedAt = Date.now();
      try {
        environment.sandbox = await startSandboxAgent(startOptions);
      } finally {
        timingLog("sandbox_start", sandboxStartStartedAt, " mode=create");
      }
    }
    environment.resumable = Boolean(plan.isDaytona && sessionForMount);
    // Track the live handle so a shutdown signal handler can delete it if `destroy` is skipped by
    // a process KILL; removed in `destroy` on every normal exit so it is never double-deleted.
    if (environment.sandbox) inFlightSandboxes.add(environment);

    // On Daytona, push the harness login, the extension, and AGENTS.md into the remote sandbox.
    // For a non-Pi harness with executable tools, also push the in-sandbox stdio MCP shim
    // assets (bundle + public-specs file): a non-Pi harness in the sandbox cannot reach the
    // runner-loopback HTTP MCP channel, so the harness's ACP adapter spawns the uploaded shim
    // as the internal stdio MCP server instead. Uploaded unconditionally for non-Pi (the
    // capability probe runs later; a harness that turns out to lack MCP fails loud in
    // `assertRequiredCapabilities` below). Pi delivers via its extension; local non-Pi uses
    // the loopback HTTP channel — neither needs this. The upload helper THROWS when the shim
    // cannot be delivered (fail loud — this path requires it).
    let internalToolMcp: ToolMcpAssets | undefined;
    if (plan.isDaytona) {
      const daytonaExtensionInstalled = await (
        deps.prepareDaytonaPiAssets ?? prepareDaytonaPiAssets
      )({
        sandbox: environment.sandbox,
        plan: { ...plan, skillDirs: [] },
        log: logger,
      });
      // Fail closed (Decision 2): same guarantee as the local path. A genuine upload failure on the
      // Daytona sandbox stops the run rather than running Pi's built-in tools unprotected.
      if (plan.isPi && plan.builtinGatingActive && !daytonaExtensionInstalled) {
        throw new Error(PI_PERMISSION_EXTENSION_UNAVAILABLE_MESSAGE);
      }
      if (!plan.isPi && plan.executableToolSpecs.length > 0) {
        internalToolMcp = await (
          deps.uploadToolMcpAssets ?? uploadToolMcpAssets
        )(
          environment.sandbox,
          plan.toolMcpDir,
          advertisedToolSpecs(plan.executableToolSpecs),
          logger,
        );
      }
    }

    // Durable cwd: mount BEFORE createSession (so the session opens inside it) and BEFORE
    // workspace materialization (so AGENTS.md, harness files, and skills land in the durable
    // prefix instead of being hidden under the FUSE mount).
    if (environment.mountCreds && plan.isDaytona) {
      const mountsStartedAt = Date.now();
      try {
        // Mount against the store's own endpoint when the sandbox can reach it (public S3); fall
        // back to the tunnel only for an in-network store. No tunnel + in-network store => skip.
        const storeEndpoint = environment.mountCreds.endpoint;
        const endpoint = storeReachableFromSandbox(storeEndpoint)
          ? undefined
          : ((await (deps.discoverTunnelEndpoint ?? discoverTunnelEndpoint)({
              log: logger,
            })) ?? undefined);
        const canMount = storeReachableFromSandbox(storeEndpoint) || !!endpoint;
        if (
          canMount &&
          (await (deps.mountStorageRemote ?? mountStorageRemote)(
            environment.sandbox,
            plan.cwd,
            environment.mountCreds,
            {
              endpoint,
              log: logger,
            },
          ))
        ) {
          logger(`remote durable cwd active for session=${sessionForMount}`);
        }
        // Per-harness session/transcript-dir mounts, remote-only by construction (this whole
        // branch is `plan.isDaytona`) — local runs never reach here, so they stay mount-free/
        // byte-identical. Transcript mounts derive from the session contract (a durable cwd mount
        // is active), with no separate public switch or credential/session-id path.
        if (canMount && sessionForMount && runCred) {
          const dirs = harnessSessionMounts(
            plan.acpAgent,
            "/home/sandbox",
            DAYTONA_PI_DIR,
          );
          await (deps.mountHarnessSessionDirs ?? mountHarnessSessionDirs)(
            environment.sandbox,
            sessionForMount,
            dirs,
            endpoint,
            {
              apiBase: apiBase(),
              authorization: runCred,
              log: logger,
            },
          );
        }
      } finally {
        timingLog("mounts", mountsStartedAt);
      }
    }
    if (
      environment.agentMountCreds &&
      agentMountDir &&
      plan.isDaytona &&
      !environment.agentMountedPath
    ) {
      const agentMountStartedAt = Date.now();
      try {
        const storeEndpoint = environment.agentMountCreds.endpoint;
        const endpoint = storeReachableFromSandbox(storeEndpoint)
          ? undefined
          : ((await (deps.discoverTunnelEndpoint ?? discoverTunnelEndpoint)({
              log: logger,
            })) ?? undefined);
        const canMount = storeReachableFromSandbox(storeEndpoint) || !!endpoint;
        const mountPath = agentMountDir;
        if (
          canMount &&
          (await (deps.mountStorageRemote ?? mountStorageRemote)(
            environment.sandbox,
            mountPath,
            environment.agentMountCreds,
            { endpoint, log: logger },
          ))
        ) {
          environment.agentMountedPath = mountPath;
          await seedAgentReadmeRemote(environment.sandbox, mountPath, {
            log: logger,
          });
          await linkAgentFilesRemote(environment.sandbox, plan.cwd, mountPath, {
            log: logger,
          });
          await activateAgentMountGuidance();
          logger(`remote agent mount active for artifact=${artifactId}`);
        }
      } catch (err) {
        logger(
          `remote agent mount failed artifact=${artifactId}: ${conciseError(err, plan.harness)}`,
        );
      } finally {
        timingLog("agent_mount", agentMountStartedAt);
      }
    }

    const prepareWorkspaceStartedAt = Date.now();
    try {
      environment.workspace = await (deps.prepareWorkspace ?? prepareWorkspace)(
        {
          sandbox: environment.sandbox,
          plan,
          piSkillSnapshot,
          log: logger,
        },
      );
    } catch (err) {
      if (
        !plan.isDaytona &&
        environment.mountCreds &&
        isTransportEndpointDisconnected(err) &&
        (await reSignAndRemountLocalCwd())
      ) {
        logger(
          `retrying workspace preparation after local durable cwd remount`,
        );
        environment.workspace = await (
          deps.prepareWorkspace ?? prepareWorkspace
        )({
          sandbox: environment.sandbox,
          plan,
          piSkillSnapshot,
          log: logger,
        });
      } else {
        throw err;
      }
    } finally {
      timingLog("prepare_workspace", prepareWorkspaceStartedAt);
    }

    // Pi native transcripts belong to the conversation workspace, not the temporary agent
    // directory that holds credentials, settings, extensions, skills, and system prompts.
    // The cwd mount is already active here on local and Daytona before Pi starts.
    if (piSessionDir) {
      if (plan.isDaytona) {
        await environment.sandbox.mkdirFs({ path: piSessionDir });
      } else {
        mkdirSync(piSessionDir, { recursive: true });
      }
    }

    // Sandbox-start invariant: `startSandboxAgent` must hand back a usable handle.
    assert(
      environment.sandbox &&
        typeof environment.sandbox.createSession === "function",
      `sandbox provider '${plan.sandboxId}' returned no usable sandbox handle`,
    );

    // Probe what this harness supports and branch on capabilities, not on the harness name.
    const probeCapabilitiesStartedAt = Date.now();
    let probed;
    try {
      probed = await (deps.probeCapabilities ?? probeCapabilities)(
        environment.sandbox,
        plan.acpAgent,
      );
    } finally {
      timingLog("probe_capabilities", probeCapabilitiesStartedAt);
    }
    const capabilities = probed.capabilities;
    environment.capabilities = capabilities;

    // Fail loud (A7): a run that REQUIRES a capability the harness lacks errors specifically
    // rather than silently dropping the behavior.
    assertRequiredCapabilities({
      harness: plan.harness,
      isPi: plan.isPi,
      probed,
      toolSpecs: plan.toolSpecs,
      log: logger,
    });

    const sessionMcp = await buildSessionMcpServers({
      isPi: plan.isPi,
      capabilities,
      harness: plan.harness,
      isDaytona: plan.isDaytona,
      toolSpecs: plan.toolSpecs,
      userMcpServers: request.mcpServers,
      relayDir: plan.relayDir,
      clientToolRelay: deferredClientToolRelay,
      signal: mcpAbort.signal,
      // The uploaded in-sandbox stdio MCP shim assets, set only on Daytona + non-Pi +
      // executable-tools; advertises the gateway tools the loopback channel cannot reach
      // from inside the sandbox. No server to close for this entry (the harness owns the
      // shim process), so `sessionMcp.close` semantics are unchanged.
      internalToolMcp,
      log: logger,
    });
    // Close the internal gateway-tool MCP server (if one started) when the session is destroyed.
    environment.closeToolMcp = sessionMcp.close;

    // Shared session-init payload for both the createSession and continuity-resume paths below.
    // Built as a plain variable (not an inline object literal at the call site) so the extra
    // `_meta` key survives the daemon SDK's narrow `Omit<NewSessionRequest, "_meta">` types —
    // the daemon's own runtime forwards `_meta` unconditionally (`normalizeSessionInit` /
    // `buildLoadSessionParams` in the vendored `sandbox-agent` patch), only the published types
    // are stricter than the wire protocol they describe.
    const claudeSystemPromptMeta: ClaudeSystemPromptMeta | undefined =
      environment.agentMountedPath && plan.acpAgent === "claude"
        ? claudeMountSystemPromptMeta(AGENT_MOUNT_SYSTEM_PROMPT_SEGMENT)
        : undefined;
    const sessionInit = {
      cwd: plan.cwd,
      mcpServers: sessionMcp.servers,
      ...(claudeSystemPromptMeta ? { _meta: claudeSystemPromptMeta } : {}),
    };

    // If this harness authored the conversation's most recent turn (staleness-guarded) and we
    // still remember its native `agentSessionId`, seed the fresh persist driver with a synthetic
    // record and resume-by-id so the patched `resumeSession` reaches `session/load` instead of
    // `session/new`. Any failure inside `resumeSession` already degrades to a plain new session
    // internally (the patch's own `catch {}` around `loadRemoteSession`), so this call is safe to
    // attempt unconditionally whenever we have an eligible id — worst case it is exactly today's
    // cold `createSession`.
    const continuitySessionKey = request.sessionId?.trim();
    const continuityStore =
      deps.sessionContinuityStore ?? sessionContinuityStore;
    // Seed the in-memory store from the durable row before consulting it, so a resume after a
    // runner restart (in-memory map lost) still sees the prior turn's eligibility. No-op (and
    // cheap) when the store already has a live in-process record.
    if (continuitySessionKey && runCred) {
      await (
        deps.hydrateHarnessSessionFromDurable ??
        hydrateHarnessSessionFromDurable
      )(continuitySessionKey, plan.harness, continuityStore, {
        authorization: runCred,
        log: logger,
      });
    }
    const priorAgentSessionId = continuitySessionKey
      ? eligibleAgentSessionId(
          continuitySessionKey,
          plan.harness,
          continuityStore,
        )
      : undefined;
    const localSessionId = continuitySessionKey
      ? `${continuitySessionKey}:${plan.harness}`
      : undefined;
    // The index THIS turn will occupy once it completes: recorded post-turn against the SAME
    // index read here, so a turn that authors turn N leaves the store agreeing with itself.
    environment.continuityTurnIndex = continuitySessionKey
      ? nextTurnIndex(continuitySessionKey, continuityStore)
      : undefined;
    // Daytona only: a local run must not overwrite a conversation's remote pointer (switching
    // sandboxes mid-conversation would strand the parked Daytona instance).
    if (plan.isDaytona && sessionForMount && runCred) {
      const liveSandboxId = environment.sandbox?.sandboxId ?? plan.sandboxId;
      const pointerWriteOutcome = await (
        deps.writeSandboxPointer ?? writeSandboxPointer
      )(
        sessionForMount,
        {
          sandboxId: liveSandboxId,
          turnIndex: environment.continuityTurnIndex ?? 0,
        },
        { authorization: runCred, log: logger },
      );
      logger(
        `sandbox pointer write ${pointerWriteOutcome} session=${sessionForMount} sandbox=${liveSandboxId}`,
      );
    }
    let loadedFromContinuity = false;
    if (priorAgentSessionId && localSessionId) {
      await persist.updateSession({
        id: localSessionId,
        agent: plan.acpAgent,
        agentSessionId: priorAgentSessionId,
        lastConnectionId: "",
        createdAt: Date.now(),
        sessionInit,
      });
      const createSessionStartedAt = Date.now();
      try {
        environment.session =
          await environment.sandbox.resumeSession(localSessionId);
        loadedFromContinuity =
          environment.session.agentSessionId === priorAgentSessionId;
        logger(
          `[continuity] session/load attempted session=${continuitySessionKey} ` +
            `harness=${plan.harness} loaded=${loadedFromContinuity}`,
        );
      } catch (err) {
        logger(
          `[continuity] resumeSession failed, falling back to cold createSession: ` +
            `${conciseError(err, plan.harness)}`,
        );
      } finally {
        timingLog("create_session", createSessionStartedAt, " mode=load");
      }
    }
    environment.loadedFromContinuity = loadedFromContinuity;
    if (!environment.session) {
      const createSessionStartedAt = Date.now();
      try {
        environment.session = await environment.sandbox.createSession({
          ...(localSessionId ? { id: localSessionId } : {}),
          agent: plan.acpAgent,
          cwd: plan.cwd,
          sessionInit,
        });
      } finally {
        timingLog("create_session", createSessionStartedAt, " mode=create");
      }
    }
    environment.sessionId = resolveRunSessionId(
      request,
      environment.session.id,
    );

    // Resolve the model first: when the harness rejects the requested id and keeps its own
    // default, `model` is undefined and the chat span is labelled "chat".
    environment.model = await (deps.applyModel ?? applyModel)(
      environment.session,
      request.model,
      logger,
      { strict: strictModel },
    );

    // Session-lifetime listeners: attach ONCE, each demuxing into the active turn's sink. They
    // outlive any single turn, so the routing lives in dedicated non-throwing helpers below.
    environment.session.onEvent((event: any) =>
      routeSessionEventToActiveTurn(
        environment,
        remountLocalCwdAfterRuntimeEnotconn,
        event,
      ),
    );
    environment.session.onPermissionRequest((req: any) =>
      routePermissionRequestToActiveTurn(environment, req),
    );

    timingLog("acquire_total", acquireStartedAt);
    return { ok: true, env: environment };
  } catch (err) {
    const error = conciseError(err, plan.harness, request.provider);
    // Mirror today's shared teardown: no otel exists yet during acquire, so there is no partial
    // trace to flush — just run the incrementally-registered finalizers and surface the error.
    await environment.destroy({ reason: "failed-turn" });
    return { ok: false, error };
  }
}

/**
 * Drop the harness's continuity record after a turn that did not complete. The harness may have
 * written a partial turn into its native transcript, so a later `session/load` would resume a
 * history the canonical request never sent. Dropping it falls back to cold replay.
 */
export function invalidateContinuity(
  sessionId: string | undefined,
  harness: string,
  deps: SandboxAgentDeps,
): void {
  if (!sessionId) return;
  (deps.sessionContinuityStore ?? sessionContinuityStore).invalidate(
    sessionId,
    harness,
  );
}
