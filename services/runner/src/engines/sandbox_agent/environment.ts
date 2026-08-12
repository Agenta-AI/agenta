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
import { join } from "node:path";

import { apiBase } from "../../apiBase.ts";

import {
  InMemorySessionPersistDriver,
  SandboxAgent,
  type SessionEvent,
  type SessionPermissionRequest,
} from "sandbox-agent";

import { resolveRunSessionId, type AgentRunRequest } from "../../protocol.ts";
import { advertisedToolSpecs } from "../../tools/public-spec.ts";
import { createAcpFetch } from "./acp-fetch.ts";
import {
  assert,
  assertRequiredCapabilities,
  probeCapabilities,
} from "./capabilities.ts";
import { DaytonaReconnectTerminalError } from "./daytona-provider.ts";
import {
  createCookieFetch,
  DAYTONA_PI_DIR,
  prepareDaytonaPiAssets,
} from "./daytona.ts";
import { applyCodexMode, resolveCodexMode } from "./codex-mode.ts";
import { conciseError } from "./errors.ts";
import { PI_MODEL_PROVIDER_OVERRIDE_ENV } from "../../extensions/model-provider-override.ts";
import {
  daytonaCredentialDeliveryPort,
  materializeDaytonaMcpServers,
} from "./daytona-secret-provider.ts";
import { buildSessionMcpServers, validateUserMcpServers } from "./mcp.ts";
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
  PI_MODEL_CONFIG_WRITE_FAILED_MESSAGE,
  PI_MODEL_OVERRIDE_EXTENSION_UNAVAILABLE_MESSAGE,
  PI_PERMISSION_EXTENSION_UNAVAILABLE_MESSAGE,
  prepareLocalPiAssets,
  uploadSystemPromptToSandbox,
  writeSystemPromptLocal,
} from "./pi-assets.ts";
import {
  AGENT_MOUNT_ENV_VAR,
  agentMountPath,
  linkAgentFiles,
  linkAgentFilesRemote,
  seedAgentReadme,
  seedAgentReadmeRemote,
} from "./agent-mount.ts";
import {
  agentMountAppendix,
  agentMountUnavailableAppendix,
} from "./agent-mount-guidance.ts";
import {
  appendPlatformGuidance,
  appendToSystemPrompt,
  claudeSystemPromptMeta,
  composeSystemPromptAppendix,
  type ClaudeSystemPromptMeta,
} from "./system-prompt-appendix.ts";
import { platformGuidanceAppendix } from "./platform-guidance.ts";
import { claudeThinkingMeta } from "./claude-thinking.ts";
import {
  describeCodexSubscriptionAuthFault,
  isSubscriptionCodexRun,
  symlinkCodexSubscriptionAuthFile,
} from "./codex-assets.ts";
import {
  routePermissionRequestToActiveTurn,
  routeSessionEventToActiveTurn,
} from "./session-events.ts";
import { buildSandboxProvider } from "./provider.ts";
import {
  markSandboxDestroyed,
  readStoredSandboxPointer,
} from "./sandbox-reconnect.ts";
import type {
  AcquireEnvironmentResult,
  SandboxAgentDeps,
  SessionEnvironment,
} from "./runtime-contracts.ts";
import {
  containsTransportEndpointDisconnected,
  isTransportEndpointDisconnected,
  runCredential,
} from "./runtime-policy.ts";
import { hydrateHarnessSessionFromDurable } from "./session-continuity-durable.ts";
import {
  eligibleAgentSessionId,
  sessionContinuityStore,
} from "./session-continuity.ts";
import { mountExpiryMs, projectScopeFor } from "./session-identity.ts";
import { teardownDisposition, type TeardownReason } from "./teardown.ts";
import {
  cleanup as cleanupWorkspace,
  materialize as materializeWorkspace,
} from "../../environment/workspace-manager.ts";
import {
  acquire as acquireSandbox,
  teardown as teardownSandbox,
} from "../../environment/sandbox-lifecycle.ts";
import { createAcquireContext } from "../../environment/acquire-context-impl.ts";
import {
  removeRuntimeFiles,
  teardownInFlight as teardownRuntimeInFlight,
} from "../../environment/runtime-lifecycle.ts";
import {
  openSession as openHarnessSession,
  probe as probeHarness,
  reopen as reopenHarnessSession,
  teardown as teardownHarnessSession,
} from "../../environment/harness-session-lifecycle.ts";
import {
  activateAgentMountGuidance as activateAgentMountGuidanceUnit,
  activateAgentMountUnavailableGuidance as activateAgentMountUnavailableGuidanceUnit,
  mountLocalAgentCwd as mountLocalAgentCwdUnit,
  mountLocalDurableCwd as mountLocalDurableCwdUnit,
  reSignAndRemountLocalCwd as reSignAndRemountLocalCwdUnit,
  remountLocalCwdAfterRuntimeEnotconn as remountLocalCwdAfterRuntimeEnotconnUnit,
  type MountDeps,
} from "../../environment/mount-lifecycle.ts";
import { uploadToolMcpAssets, type ToolMcpAssets } from "./tool-mcp-assets.ts";
import { prepareWorkspace } from "./workspace.ts";
import { prepareEnvironmentSetup } from "./environment-setup.ts";
import { wrapMockSandbox } from "./mock-session.ts";

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
  const setup = await prepareEnvironmentSetup(request, deps, presignedMount);
  if (!setup.ok) return setup;
  const {
    acquireStartedAt,
    agentMountDir,
    artifactId,
    binaryPath,
    deferredClientToolRelay,
    deferredExecutableToolGate,
    env,
    environment,
    localBuiltinGatingUnenforceable,
    localModelConfigUnwritable,
    localModelOverrideUnenforceable,
    logger,
    mcpAbort,
    piExtEnv,
    piModelConfig,
    piModelConfigError,
    piSessionDir,
    piSkillSnapshot,
    plan,
    runCred,
    sessionForMount,
    signAgentMount,
    signMount,
    strictModel,
    timingLog,
  } = setup;
  let runAgentDir = setup.runAgentDir;

  // ---- MountLifecycle ------------------------------------------------------------------ //
  // The six mount helpers moved to `environment/mount-lifecycle.ts`. They used to be mutually
  // recursive closures over this scope; they now take `ctx` and capture nothing. `ctx` is the
  // only thing that carries the shared state, and it exposes the environment as a read-only
  // projection so a unit cannot reach a field it does not own. See `environment/acquire-context.ts`.
  const { context: ctx } = createAcquireContext({
    environment,
    plan,
    env,
    piExtEnv,
    sessionForMount,
    artifactId,
    runCred,
    log: logger,
    timingLog,
    remountLimit: LOCAL_DURABLE_CWD_ENOTCONN_REMOUNT_LIMIT,
    combineAppendSystemPrompt: appendToSystemPrompt,
    // Needs the raw daemon env map, which units must not see, so it is injected here.
    reprepareLocalPiAssets: () =>
      prepareLocalPiAssets({ plan, env, log: logger }).dir,
  });
  // `ctx` is built BEFORE `destroy` is assigned, and the order is load-bearing. `destroy` calls
  // `ctx.recordCwdUnmountResult`, and a `const` stays in the temporal dead zone until its own
  // declaration runs. With the context created later, a throw from `createAcquireContext` left
  // `acquireEnvironment` rejecting with no `destroy` ever called, so the skills temp root leaked;
  // and any future call to `destroy()` from between the two points raised a ReferenceError
  // instead of tearing the environment down.
  // The one complete, idempotent teardown — the same steps the old per-run `finally` ran, in the
  // same order. Every resource is null-checked, so it is safe after a partial acquire and safe to
  // call twice (the guard returns on a second call). It must never throw.
  environment.destroy = async (opts?: { reason?: TeardownReason }) => {
    if (environment.destroyed) return;
    environment.destroyed = true;
    // RuntimeLifecycle quiesces everything that could still be running. This must come FIRST:
    // an in-flight remount or a live `tools/call` would otherwise land against freed state.
    await teardownRuntimeInFlight({
      runtimeRemount: environment.runtimeRemount,
      toolRelay: environment.currentTurn?.toolRelay,
      mcpAbort: environment.mcpAbort,
      closeToolMcp: environment.closeToolMcp,
    });
    inFlightSandboxes.delete(environment);
    // Graceful `session/cancel` BEFORE tearing down the daemon, or the ACP adapter subprocess
    // reparents to PID 1 and never exits. Skip if the pause path already sent it.
    await teardownHarnessSession({
      sandbox: environment.sandbox,
      session: environment.session,
      alreadyRequested: !!environment.sessionDestroyRequested,
    });
    // SandboxLifecycle owns park-versus-delete. It returns `parked` because the mount teardown
    // below is gated on it: a parked Daytona sandbox keeps its agent mount.
    const { parked } = await teardownSandbox({
      sandbox: environment.sandbox,
      plannedSandboxId: plan.sandboxId,
      isDaytona: plan.isDaytona,
      harness: plan.harness,
      reason: opts?.reason,
      log: logger,
    });
    // Unmount the durable cwd BEFORE removing the dir: data lives in the store, only the host
    // mountpoint is torn down. If unmount is not CONFIRMED gone, skip the delete: rmSync must
    // never run against a possibly-live FUSE mount into the durable store.
    if (environment.mountedCwd) {
      // One of `durableCwdSafeToDelete`'s three named transitions. A wrong `true` here runs a
      // recursive delete against a possibly-live FUSE mount into the durable store.
      ctx.recordCwdUnmountResult(
        await (environment.deps.unmountStorage ?? unmountStorage)(
          environment.mountedCwd,
          { log },
        ).catch(() => false),
      );
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
        `durable cwd unmount not confirmed, skipping workspace cleanup cwd=${plan.workspace.cwd}`,
      );
    } else {
      await cleanupWorkspace(environment.workspace);
    }
    // RuntimeLifecycle owns the runner-written files. The reasoning for each — and for the
    // Codex auth.json backstop that deliberately does NOT exist — lives with the unit.
    removeRuntimeFiles({
      runAgentDir: environment.runAgentDir,
      otlpAuthFilePath: environment.otlpAuthFilePath,
      codexSqliteHome: environment.codexSqliteHome,
    });
    // Remove the per-run skills temp root the materializer created (success or error).
    plan.workspace.skillsCleanup();
  };

  const mountDeps: MountDeps = {
    ...(deps.mountStorage ? { mountStorage: deps.mountStorage } : {}),
    signMount,
    signAgentMount,
    daytonaPiDir: DAYTONA_PI_DIR,
  };
  const mountLocalDurableCwd = (reason: string) =>
    mountLocalDurableCwdUnit(ctx, mountDeps, reason);
  const mountLocalAgentCwd = () => mountLocalAgentCwdUnit(ctx, mountDeps);
  const reSignAndRemountLocalCwd = () =>
    reSignAndRemountLocalCwdUnit(ctx, mountDeps);
  const activateAgentMountGuidance = () =>
    activateAgentMountGuidanceUnit(ctx, mountDeps);
  const activateAgentMountUnavailableGuidance = () =>
    activateAgentMountUnavailableGuidanceUnit(ctx, mountDeps);
  const remountLocalCwdAfterRuntimeEnotconn = (event: unknown) =>
    remountLocalCwdAfterRuntimeEnotconnUnit(ctx, mountDeps, event);

  try {
    // Fail loud before any sandbox/mount infra spins up: an applicable-but-incomplete
    // OpenAI-compatible custom request is a hard error, never a silent fall-back (Decision 5).
    if (piModelConfigError) {
      throw piModelConfigError;
    }
    // Fail closed before any sandbox/mount infra spins up: a local Pi run whose policy could gate a
    // built-in tool cannot proceed without the permission extension installed (Decision 2).
    if (localBuiltinGatingUnenforceable) {
      throw new Error(PI_PERMISSION_EXTENSION_UNAVAILABLE_MESSAGE);
    }
    // Fail closed: a local managed custom run whose models.json could not be materialized cannot
    // fall through to a default provider (Decision 6).
    if (localModelConfigUnwritable) {
      throw new Error(PI_MODEL_CONFIG_WRITE_FAILED_MESSAGE);
    }
    // Fail closed: a Pi run that routes its provider through the extension's model endpoint
    // override cannot run without the extension — the model would silently hit the default
    // endpoint with the wrong credentials.
    if (localModelOverrideUnenforceable) {
      throw new Error(PI_MODEL_OVERRIDE_EXTENSION_UNAVAILABLE_MESSAGE);
    }
    // Structural + SSRF validation of user MCP servers BEFORE any sandbox (or Daytona Secret) is
    // created, so an invalid credentialed server never triggers remote side effects.
    await validateUserMcpServers(request.mcpServers);
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
    // INVARIANT 1: the provider takes `env` and `piExtEnv` BY REFERENCE and hands them to the
    // daemon, after which the daemon environment is fixed. Every local mount had to land above
    // this line. From here a `writeDaemonEnv` is a programming-order bug and throws.
    ctx.freezeDaemonEnv();
    const sandboxProvider = (deps.buildSandboxProvider ?? buildSandboxProvider)(
      plan.sandboxId,
      env,
      binaryPath,
      piExtEnv,
      plan.credentials.modelEnvironment,
      plan.sandboxPermission,
      plan.credentials.daytonaSecretPlan,
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
    // SandboxLifecycle owns the reconnect ladder, the fresh-create fallback, and both
    // `sandbox_start` timing marks. See `environment/sandbox-lifecycle.ts`.
    const acquiredSandbox = await acquireSandbox(
      {
        startOptions,
        isDaytona: plan.isDaytona,
        harness: plan.harness,
        sessionForMount,
        runCred,
        log: logger,
        timingLog,
      },
      {
        startSandboxAgent: startSandboxAgent as unknown as (
          options: Record<string, unknown>,
        ) => Promise<unknown>,
        ...(deps.readStoredSandboxPointer
          ? { readStoredSandboxPointer: deps.readStoredSandboxPointer }
          : {}),
      },
    );
    environment.sandbox = acquiredSandbox.sandbox;
    // "mock" runs in-process on the real sandbox: only createSession is replaced.
    if (plan.acpAgent === "mock" && environment.sandbox) {
      environment.sandbox = wrapMockSandbox(environment.sandbox, plan.isDaytona);
    }
    environment.resumable = acquiredSandbox.resumable;
    // Read AFTER the sandbox is acquired, because the port is bound to a sandbox: the provider has
    // no allocation to deliver against until create (or reconnect) has settled. Undefined for
    // every provider that cannot deliver a credential to a live sandbox, which is what routes a
    // rotation there back to a rebuild. See `daytonaCredentialDeliveryPort`.
    environment.credentialDelivery =
      daytonaCredentialDeliveryPort(sandboxProvider);
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
        plan: { ...plan, workspace: { ...plan.workspace, skillDirs: [] } },
        piModelConfig,
        log: logger,
      });
      // Fail closed (Decision 2): same guarantee as the local path. A genuine upload failure on the
      // Daytona sandbox stops the run rather than running Pi's built-in tools unprotected.
      if (
        plan.isPi &&
        plan.tools.builtinGatingActive &&
        !daytonaExtensionInstalled
      ) {
        throw new Error(PI_PERMISSION_EXTENSION_UNAVAILABLE_MESSAGE);
      }
      // Fail closed: the Pi model endpoint override rides the extension; without it the model
      // would silently hit the default endpoint with the wrong credentials.
      if (
        plan.isPi &&
        piExtEnv[PI_MODEL_PROVIDER_OVERRIDE_ENV] !== undefined &&
        !daytonaExtensionInstalled
      ) {
        throw new Error(PI_MODEL_OVERRIDE_EXTENSION_UNAVAILABLE_MESSAGE);
      }
      if (!plan.isPi && plan.tools.toolSpecs.length > 0) {
        // Advertise the FULL tool set to the shim, client tools included: a parked client tool
        // resolves through the relay's paused answer (see startToolRelay / tool-mcp-stdio.ts).
        internalToolMcp = await (
          deps.uploadToolMcpAssets ?? uploadToolMcpAssets
        )(
          environment.sandbox,
          plan.workspace.toolMcpDir,
          advertisedToolSpecs(plan.tools.toolSpecs),
          logger,
        );
      }
      // Managed Codex is file-free on Daytona too (the SDK-rendered custom provider reads
      // OPENAI_API_KEY from the daemon env at request time; configureDaytonaCodexEnv set CODEX_HOME
      // to the durable <cwd>/.codex and CODEX_SQLITE_HOME off-mount). Nothing to write here.
    }

    /**
     * Why a durable mount could not be attempted, or undefined when it could.
     *
     * The two causes need different fixes, so the operator line must name which one: an absent
     * tunnel is an infrastructure seat to claim, while an unreachable store is a networking or
     * endpoint problem. A warning that says only "mounts skipped" sends the reader back into this
     * file to find out which.
     */
    const mountRefusal = (
      endpoint: string | undefined,
      tunnel: string | undefined,
    ): "store-unreachable-and-no-tunnel" | undefined =>
      storeReachableFromSandbox(endpoint) || tunnel
        ? undefined
        : "store-unreachable-and-no-tunnel";
    /** Set when a durable mount was ATTEMPTED and refused. Drives the model-facing sentence. */
    let agentMountSkipped: string | undefined;

    // Durable cwd: mount BEFORE createSession (so the session opens inside it) and BEFORE
    // workspace materialization (so AGENTS.md, harness files, and skills land in the durable
    // prefix instead of being hidden under the FUSE mount).
    if (environment.mountCreds && plan.isDaytona) {
      const mountsStartedAt = Date.now();
      try {
        // Mount against the store's own endpoint when the sandbox can reach it (public S3); fall
        // back to the tunnel only for an in-network store. No tunnel + in-network store => the
        // mount is REFUSED, and the refusal is announced rather than silent. It used to be
        // silent, and the cost was not theoretical: the run continued on an empty directory, the
        // model went looking for the user's saved files because its own history showed an earlier
        // session where they were there, found nothing, and told the user their work was missing.
        // Both surfaces now say so, the operator through the WARN below and the model through
        // `agentMountUnavailableGuidance`.
        const storeEndpoint = environment.mountCreds.endpoint;
        const endpoint = storeReachableFromSandbox(storeEndpoint)
          ? undefined
          : ((await (deps.discoverTunnelEndpoint ?? discoverTunnelEndpoint)({
              log: logger,
            })) ?? undefined);
        const refusal = mountRefusal(storeEndpoint, endpoint);
        const canMount = !refusal;
        if (refusal) {
          // WARN, not debug, and once per acquire rather than once per day: a run whose durable
          // cwd is missing behaves differently for the whole session, and the operator needs the
          // cause named to know which thing to fix.
          logger(
            `WARN durable cwd mount SKIPPED for session=${sessionForMount}: ${refusal}. ` +
              "The run continues on throwaway storage; nothing the agent writes to the working " +
              "directory survives this session.",
          );
        }
        if (
          canMount &&
          (await (deps.mountStorageRemote ?? mountStorageRemote)(
            environment.sandbox,
            plan.workspace.cwd,
            environment.mountCreds,
            {
              endpoint,
              log: logger,
            },
          ))
        ) {
          environment.installedMountExpiries.cwd = mountExpiryMs(
            environment.mountCreds.expiresAt,
          );
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
        const refusal = mountRefusal(storeEndpoint, endpoint);
        const canMount = !refusal;
        const mountPath = agentMountDir;
        if (refusal) {
          agentMountSkipped = refusal;
          logger(
            `WARN durable agent mount SKIPPED for artifact=${artifactId}: ${refusal}. ` +
              "The agent's durable folder is absent this run; the model is told so explicitly " +
              "so it does not report the user's saved work as missing.",
          );
          // Pi reads its guidance from the append-prompt channel, so the negative sentence has to
          // be delivered here. Claude takes the same statement through the session-init `_meta`
          // built below, off `agentMountSkipped`.
          await activateAgentMountUnavailableGuidance();
        }
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
          environment.installedMountExpiries.agent = mountExpiryMs(
            environment.agentMountCreds.expiresAt,
          );
          await seedAgentReadmeRemote(environment.sandbox, mountPath, {
            log: logger,
          });
          await linkAgentFilesRemote(
            environment.sandbox,
            plan.workspace.cwd,
            mountPath,
            { log: logger },
          );
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
    // The instructions file is the fourth guidance channel, and the only one every harness reads.
    // It is composed HERE rather than in `run-plan.ts` because the mount arm needs mount state:
    // both agent-mount paths above run before this point (local at `mountLocalAgentCwd`, Daytona
    // in the block just above), so `agentMountedPath` and `agentMountSkipped` are settled and the
    // file can state what is true instead of what was hoped for.
    //
    // The guidance rides a COPY of the plan. `plan.prompt.agentsMd` is the author's text, and the
    // rest of the run should keep seeing it that way; only the write wants the rendered form.
    const guidance = platformGuidanceAppendix({
      acpAgent: plan.acpAgent,
      isPi: plan.isPi,
      agentMountedPath: environment.agentMountedPath,
      agentMountSkipped: !!agentMountSkipped,
      // Mirrors prepareWorkspace's materialization split: Pi reads an immutable
      // `agents/skills/<digest>` snapshot; other harnesses read `.{acpAgent}/skills/<name>`.
      skillsPath: plan.workspace.skillDirs.length
        ? plan.isPi
          ? join(plan.workspace.cwd, "agents", "skills")
          : join(plan.workspace.cwd, `.${plan.acpAgent}`, "skills")
        : undefined,
      toolNames: plan.tools.toolSpecs.map((spec) => spec.name),
    });
    const guidedPlan = guidance
      ? {
          ...plan,
          prompt: {
            ...plan.prompt,
            agentsMd: appendPlatformGuidance(plan.prompt.agentsMd, guidance),
          },
        }
      : plan;
    // WorkspaceManager owns the write; the retry stays here because it re-signs a MOUNT, which is
    // the mount unit's concern, not the workspace's.
    const workspaceInput = {
      sandbox: environment.sandbox,
      plan: guidedPlan,
      piSkillSnapshot,
      log: logger,
    };
    try {
      const materialized = await materializeWorkspace(workspaceInput, deps);
      environment.workspace = materialized;
      // The record a later in-place refresh needs to know what to DELETE.
      environment.workspaceInventory = materialized.inventory;
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
        const retried = await materializeWorkspace(workspaceInput, deps);
        environment.workspace = retried;
        environment.workspaceInventory = retried.inventory;
      } else {
        throw err;
      }
    } finally {
      timingLog("prepare_workspace", prepareWorkspaceStartedAt);
    }

    // Managed Codex is file-free (the SDK renders a custom provider with env_key OPENAI_API_KEY into
    // <cwd>/.codex/config.toml; codex reads the key from the daemon env at request time), so there is
    // nothing to write. A local subscription run still needs the operator's OAuth token file, so
    // symlink <cwd>/.codex/auth.json to the mounted login now, after the durable cwd mount (linking
    // before it would be shadowed). `mountLocalDurableCwd` links on every mount, so this covers the
    // run that has no durable mount at all (object store unconfigured) and is a no-op otherwise.
    // Non-Codex runs, managed runs, and Daytona are no-ops.
    if (isSubscriptionCodexRun(plan))
      await symlinkCodexSubscriptionAuthFile(plan, logger);

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
    // HarnessSessionLifecycle owns the stage and its timing mark.
    const probed = await probeHarness(
      {
        sandbox: environment.sandbox,
        acpAgent: plan.acpAgent,
        timingLog,
      },
      {
        ...(deps.probeCapabilities
          ? { probeCapabilities: deps.probeCapabilities }
          : {}),
      },
    );
    const capabilities = probed.capabilities;
    environment.capabilities = capabilities;

    // Fail loud (A7): a run that REQUIRES a capability the harness lacks errors specifically
    // rather than silently dropping the behavior.
    assertRequiredCapabilities({
      harness: plan.harness,
      isPi: plan.isPi,
      probed,
      toolSpecs: plan.tools.toolSpecs,
      log: logger,
    });

    const sessionMcp = await buildSessionMcpServers({
      isPi: plan.isPi,
      capabilities,
      harness: plan.harness,
      isDaytona: plan.isDaytona,
      toolSpecs: plan.tools.toolSpecs,
      // On a Daytona Secrets run the provider swaps each MCP credential value for its Daytona
      // Secret placeholder, so no plaintext secret rides the sandbox-bound session config.
      userMcpServers: materializeDaytonaMcpServers(
        sandboxProvider,
        request.mcpServers,
      ),
      relayDir: plan.workspace.relayDir,
      clientToolRelay: deferredClientToolRelay,
      executableToolGate:
        !plan.isPi && !plan.isDaytona ? deferredExecutableToolGate : undefined,
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
    // Three states, not two. A mount that WORKED advertises its resolved absolute path; a mount
    // that was attempted and SKIPPED says so, because the model's history may show an earlier
    // session where the folder worked and only a statement in this turn can contradict it; a run
    // with no durable storage configured says nothing, so a permanently tunnel-less stack does not
    // carry the caveat as eternal noise.
    // One ordered composition, so a contributor added later is placed here deliberately rather
    // than appended by whichever call site happens to run last. The mount is the only contributor
    // today; the delivery below is unchanged.
    const claudeAppendix =
      plan.acpAgent === "claude"
        ? composeSystemPromptAppendix([
            environment.agentMountedPath
              ? agentMountAppendix(environment.agentMountedPath)
              : agentMountSkipped
                ? agentMountUnavailableAppendix()
                : undefined,
          ])
        : undefined;
    const claudeAppendixMeta: ClaudeSystemPromptMeta | undefined =
      claudeAppendix ? claudeSystemPromptMeta(claudeAppendix) : undefined;
    // Claude-only: request visible ("summarized") extended-thinking display so the model's
    // reasoning reaches the runner (and the playground). Without it, recent Claude models
    // return signature-only thinking and no reasoning surfaces. See `claude-thinking.ts`.
    const claudeThinking =
      plan.acpAgent === "claude" ? claudeThinkingMeta() : undefined;
    // Disjoint `_meta` keys (`systemPrompt` vs `claudeCode`), so a shallow merge keeps both.
    // A future second `claudeCode` producer would need a deep merge here.
    const claudeMeta =
      claudeAppendixMeta || claudeThinking
        ? { ...(claudeAppendixMeta ?? {}), ...(claudeThinking ?? {}) }
        : undefined;
    const sessionInit = {
      cwd: plan.workspace.cwd,
      mcpServers: sessionMcp.servers,
      ...(claudeMeta ? { _meta: claudeMeta } : {}),
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
    // The live sandbox id rides forward as a field on the turn-append row written at turn end
    // (see `appendSessionTurn` call in `runTurn`), not a separate pre-turn pointer PUT: the
    // turns table is append-only, so there is nothing to overwrite mid-conversation.
    // HarnessSessionLifecycle owns both open modes and both `create_session` timing marks.
    const opened = await openHarnessSession({
      sandbox: environment.sandbox,
      persist,
      acpAgent: plan.acpAgent,
      harness: plan.harness,
      cwd: plan.workspace.cwd,
      sessionInit,
      priorAgentSessionId,
      localSessionId,
      continuitySessionKey,
      log: logger,
      timingLog,
    });
    environment.session = opened.session;
    environment.loadedFromContinuity = opened.loadedFromContinuity;
    // The reopen capability, captured here because this is the only scope holding the persist
    // driver, the session-init payload and the local session key together. Same pattern as
    // `destroy`: the environment carries a closure rather than the ingredients.
    environment.reopenSession = async ({ transcriptReplayable }) => {
      const result = await reopenHarnessSession({
        sandbox: environment.sandbox,
        persist,
        acpAgent: plan.acpAgent,
        harness: plan.harness,
        cwd: plan.workspace.cwd,
        sessionInit,
        priorAgentSessionId: environment.session?.agentSessionId,
        localSessionId,
        continuitySessionKey,
        log: logger,
        timingLog,
        current: environment.session,
        transcriptReplayable,
      });
      if (result.ok) {
        environment.session = result.session;
        environment.loadedFromContinuity = result.loadedFromContinuity;
      }
      return result;
    };
    environment.sessionId = resolveRunSessionId(
      request,
      environment.session.id,
    );

    // Resolve the model first: when the harness rejects the requested id and keeps its own
    // default, `model` is undefined and the chat span is labelled "chat".
    //
    // For a managed OpenAI-compatible custom run, request the FULLY QUALIFIED
    // `<connection-slug>/<model-id>` that pi-acp advertises for this provider, not the bare wire
    // model id (design Decision 7). `applyModel`/`pickModel` fall back to suffix matching, which
    // returns the FIRST advertised id whose suffix matches — so a built-in `openai/<model>` that
    // Pi still advertises (the vault key rides in as `OPENAI_API_KEY`, keeping Pi's built-in
    // openai provider live) would be selected ahead of the custom `<slug>/<model>` when both share
    // the model id. That would silently route to api.openai.com instead of the user's endpoint.
    // The qualified id is an EXACT match, so it always wins over any bare-suffix collision.
    const wantedModel =
      piModelConfig && piModelConfig.models.length > 0
        ? `${piModelConfig.providerId}/${piModelConfig.models[0].id}`
        : request.model;
    environment.model = await (deps.applyModel ?? applyModel)(
      environment.session,
      wantedModel,
      logger,
      { strict: strictModel },
    );
    if (plan.acpAgent === "codex") {
      const mode = resolveCodexMode(request.harnessMode);
      await (deps.applyCodexMode ?? applyCodexMode)(
        environment.session,
        mode,
        logger,
      );
    }

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
    const error = conciseError(
      err,
      plan.harness,
      request.modelConnection?.provider,
      { authFault: () => describeCodexSubscriptionAuthFault(plan) },
    );
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
