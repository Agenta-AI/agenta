import { rmSync } from "node:fs";

import { apiBase } from "../../apiBase.ts";
import { appliedStateForRequest } from "./applied-state.ts";

import { resolveRunSessionId, type AgentRunRequest } from "../../protocol.ts";
import { type ClientToolOutcome } from "../../responder.ts";
import type { ClientToolRelay } from "../../tools/client-tool-relay.ts";
import type {
  ExecutableToolGate,
  ExecutableToolVerdict,
} from "../../tools/executable-tool-gate.ts";
import { agentMountPath, signAgentMountCredentials } from "./agent-mount.ts";
import { createToolCallCorrelationIndex } from "./client-tools.ts";
import {
  configureCodexHome,
  configureDaytonaCodexEnv,
} from "./codex-assets.ts";
import { buildDaemonEnv, resolveDaemonBinary } from "./daemon.ts";
import { conciseError } from "./errors.ts";
import { signSessionMountCredentials, type MountCredentials } from "./mount.ts";
import { PI_MODEL_PROVIDER_OVERRIDE_ENV } from "../../extensions/model-provider-override.ts";
import {
  buildPiExtensionEnv,
  configurePiSessionWorkspace,
  configurePiSkillSnapshot,
  prepareLocalPiAssets,
  resolvePiSkillSnapshot,
  writeOtlpAuthFile,
} from "./pi-assets.ts";
import {
  buildPiModelConfigPlan,
  buildPiModelRegistrationPlan,
  describePiModelsJsonPlan,
  type PiModelsJsonPlan,
} from "./pi-model-config.ts";
import { loadPiBuiltinRegistry } from "./pi-builtin-registry.ts";
import { buildRunPlan } from "./run-plan.ts";
import { configFingerprint } from "./session-identity.ts";
import type {
  SandboxAgentDeps,
  SessionEnvironment,
} from "./runtime-contracts.ts";
import {
  applyClaudeConnectionEnv,
  defaultResolveLocalRunnerOwner,
  modelResolutionStrict,
  runCredential,
} from "./runtime-policy.ts";
import { assertLocalRunnerOwnership } from "./session-continuity.ts";
import {
  projectScopeFor,
  resolvesToLocalProvider,
} from "./session-identity.ts";
import { loadRunnerConfig } from "../../config/runner-config.ts";
import { buildRuntimeEnvironment } from "../../environment/runtime-lifecycle.ts";
import { createTimingLog } from "../../environment/timing.ts";

function defaultLog(message: string): void {
  process.stderr.write(`[sandbox-agent] ${message}\n`);
}

export async function prepareEnvironmentSetup(
  request: AgentRunRequest,
  deps: SandboxAgentDeps = {},
  presignedMount?: MountCredentials | null,
) {
  const logger = deps.log ?? defaultLog;
  const acquireStartedAt = Date.now();
  // The stage names are matched by dashboards; see `environment/timing.ts`. The accessors are
  // read at call time on purpose: the sandbox does not exist yet, and the session id changes
  // during acquire, so capturing either by value would log a stale `-`.
  const timingLog = createTimingLog(logger, {
    sandboxId: () => environment?.sandbox?.sandboxId,
    sessionId: () => environment?.sessionId ?? request.sessionId?.trim(),
  });

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
      return {
        ok: false as const,
        error: conciseError(err, request.harness ?? ""),
      };
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
  if (!planResult.ok) return { ok: false as const, error: planResult.error };
  const plan = planResult.plan;
  const piSkillSnapshot = resolvePiSkillSnapshot(plan);
  const agentMountDir = agentMountCreds
    ? agentMountPath(plan.workspace.cwd)
    : undefined;

  // Clear-then-apply (Security rule 5): on a managed run (credentialMode "env") the daemon
  // inherits NONE of the sidecar's own provider keys, so only the resolved
  // `plan.credentials.modelEnvironment` is present and an inherited key for another
  // provider cannot leak.
  // "none" asserts NO credential (connections/models.py), so it clears too — otherwise the
  // daemon would inherit the declared provider's keys (e.g. OPENAI_API_KEY) from the sidecar.
  // RuntimeLifecycle BUILDS the daemon world: both env maps plus the 0600 OTLP bearer file.
  // That was never planning, which is why it moved out of this file (lifecycle migration,
  // step 5). See `environment/runtime-lifecycle.ts` for the ordering rule inside it.
  const runtimeEnvironment = buildRuntimeEnvironment({
    plan,
    request,
    piSkillSnapshot,
    log: logger,
    deps: {
      ...(deps.buildDaemonEnv ? { buildDaemonEnv: deps.buildDaemonEnv } : {}),
    },
  });
  const env = runtimeEnvironment.env;
  const piExtEnv = runtimeEnvironment.piExtEnv;
  const piSessionDir = runtimeEnvironment.piSessionDir;
  const otlpAuthFilePath = runtimeEnvironment.otlpAuthFilePath;
  const strictModel = modelResolutionStrict();
  logger(
    `tools=${plan.tools.toolSpecs.length} executableTools=${plan.tools.executableToolSpecs.length} ` +
      `piPublicTools=${piExtEnv.AGENTA_AGENT_TOOLS_PUBLIC_SPECS ? "yes" : "no"}`,
  );
  if (!plan.isPi && plan.isDaytona) {
    const clientTools = plan.tools.toolSpecs
      .filter((spec) => spec.kind === "client")
      .map((spec) => spec.name);
    if (clientTools.length > 0) {
      // Client tools ride the Daytona stdio shim alongside executable tools: the model sees them,
      // calls them, and the call parks (the relay writes a benign paused answer). See mcp.ts.
      logger(
        `advertising client tools on the Daytona stdio MCP shim: ${clientTools.join(", ")}`,
      );
    }
  }
  // Translate a managed OpenAI-compatible custom connection into Pi's native models.json plan
  // (design Decision 5). Non-applicable requests yield no plan (current behavior); an applicable
  // but incomplete request throws — captured here and re-thrown inside the try below so the
  // engine's own catch turns it into `{ ok: false, error }` and a visible error frame (fail loud,
  // never a silent fall-back to a default provider). Only the env var NAME enters the plan.
  let piModelConfig: PiModelsJsonPlan | undefined;
  let piModelConfigError: Error | undefined;
  if (plan.isPi) {
    try {
      // The presence check consults the FULL materialized model environment: on a Daytona
      // Secrets run the opaque key left `plan.credentials.modelEnvironment` for the
      // secret plan, but the sandbox still receives its binding (as a Daytona Secret
      // attachment).
      const fullModelEnvironment: Record<string, string> = {
        ...plan.credentials.modelEnvironment,
      };
      const secretCandidates = plan.credentials.daytonaSecretPlan?.candidates;
      for (const candidate of secretCandidates ?? []) {
        if (candidate.consumer.kind === "model") {
          fullModelEnvironment[candidate.binding.name] = candidate.value;
        }
      }
      piModelConfig = buildPiModelConfigPlan(request, fullModelEnvironment);
    } catch (err) {
      piModelConfigError = err as Error;
    }
  }
  // No custom provider to register, but the requested model may still be one Pi's static registry
  // does not carry — a hand-entered id such as an OpenRouter routing variant. Pi refuses to select
  // an unregistered model, so merge it into its built-in provider for this run only.
  //
  // Skipped for a local subscription run: its Pi agent dir is the operator's own mounted login,
  // which `prepareLocalPiAssets` uses in place and must not be rewritten per run. A Daytona run
  // has no such mount (its agent dir lives in the sandbox), so registration applies there.
  const canWritePiModelsJson =
    plan.isDaytona || plan.credentials.credentialMode !== "runtime_provided";
  if (
    plan.isPi &&
    !piModelConfig &&
    !piModelConfigError &&
    canWritePiModelsJson
  ) {
    const registry = await loadPiBuiltinRegistry(logger);
    if (registry) {
      piModelConfig = buildPiModelRegistrationPlan(request, registry);
    }
  }
  if (piModelConfig) {
    logger(`pi models.json plan ${describePiModelsJsonPlan(piModelConfig)}`);
  }

  // undefined is fine: the local provider runs its own resolution and errors clearly.
  const binaryPath = (deps.resolveDaemonBinary ?? resolveDaemonBinary)();
  const localPiAssets = prepareLocalPiAssets({
    plan,
    env,
    piModelConfig,
    log: logger,
  });
  let runAgentDir = localPiAssets.dir;
  // Local managed Codex authenticates from `<cwd>/.codex/auth.json`; point CODEX_HOME at that
  // directory now (a path only, safe before the durable cwd mount), and point CODEX_SQLITE_HOME
  // at a local off-mount directory. The auth.json file itself is written after the mount, right
  // after prepareWorkspace (see environment.ts). Non-Codex runs and Daytona are no-ops.
  const codexSqliteHome = configureCodexHome(plan, env);
  // Fail closed (Decision 6): a local managed custom run whose models.json could not be written
  // must stop rather than run on a default provider. Recorded here (the write ran above) and
  // thrown inside the try below, like the permission-extension gate.
  const localModelConfigUnwritable =
    plan.isPi &&
    !plan.isDaytona &&
    !!piModelConfig &&
    !localPiAssets.modelConfigWritten;
  // Fail closed (Decision 2): when the policy could gate a Pi built-in tool but the permission
  // extension did not install, the run must stop rather than run those tools unprotected. Recorded
  // here (the install ran above) and thrown inside the try below so the engine's own catch turns it
  // into `{ ok: false, error }` and a visible error frame. `builtinGatingActive` false means
  // allow-everything, where the extension is not needed and a failed install is harmless.
  const localBuiltinGatingUnenforceable =
    plan.isPi &&
    !plan.isDaytona &&
    plan.tools.builtinGatingActive &&
    !localPiAssets.extensionInstalled;
  // Fail closed: a Pi run whose provider routing rides the extension's model endpoint override
  // (`model-provider-override.ts`, set in `buildPiExtensionEnv`) cannot run without the
  // extension — the harness would silently call the provider's default endpoint. Recorded here
  // and thrown inside the engine try, like the two gates above.
  const localModelOverrideUnenforceable =
    plan.isPi &&
    !plan.isDaytona &&
    piExtEnv[PI_MODEL_PROVIDER_OVERRIDE_ENV] !== undefined &&
    !localPiAssets.extensionInstalled;
  // Fail closed: a subscription run whose operator-mounted Pi agent dir failed the write probe
  // cannot start — Pi dies at startup on the unwritable dir with zero output, which the user sees
  // as a session that silently hangs. Recorded here (the probe ran above) and thrown inside the
  // engine try, like the three gates above, so it becomes a visible error frame.
  const localPiAgentDirUnwritable =
    plan.isPi && !plan.isDaytona && !localPiAssets.agentDirWritable;

  // A local Claude subscription run reads and writes the operator's read-write mounted login
  // DIRECTLY: `buildDaemonEnv` already carried `CLAUDE_CONFIG_DIR` (the mount) into the daemon env,
  // and there is deliberately no per-run copy. Claude refreshes its OAuth token mid-run and writes
  // it back to its config dir; copying that dir per run would discard the refresh, so the next run
  // would fail as soon as the provider rotated the refresh token. The harness owns its own token
  // lifecycle, exactly like a normal local install (interface.md section 6). buildRunPlan already
  // rejected a runtime_provided Claude run with no configured CLAUDE_CONFIG_DIR.

  logger(
    `harness=${plan.harness} sandbox=${plan.sandboxId} cwd=${plan.workspace.cwd}`,
  );

  // The resolved model ref as it reaches the runner (key NAMES only, never values) — the one
  // line that answers "what model/provider/deployment/credential did this run actually use".
  logger(
    `resolved model=${request.model ?? "<none>"} provider=${request.modelConnection?.provider ?? "<none>"} ` +
      `deployment=${request.modelConnection?.deployment ?? "<none>"} ` +
      `connection=${request.connection ? `${request.connection.mode}:${request.connection.slug ?? "-"}` : "<none>"} ` +
      `credentialMode=${request.modelConnection?.credentialMode ?? "<none>"} ` +
      `credentialBindings=[${(request.modelConnection?.credentials ?? [])
        .map((credential) => credential.binding.name)
        .join(",")}]`,
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
  const executableToolGateRef: { current?: ExecutableToolGate } = {};
  const deferredExecutableToolGate: ExecutableToolGate = {
    onExecutableTool: (req) =>
      executableToolGateRef.current
        ? executableToolGateRef.current.onExecutableTool(req)
        : Promise.resolve({
            kind: "deny",
            reason: `Tool '${req.toolName}' was denied by policy.`,
          } satisfies ExecutableToolVerdict),
    onPause: () => executableToolGateRef.current?.onPause?.(),
  };

  // Aborts any in-flight loopback `tools/call` on pause/teardown,
  // so its handler is torn down deterministically and cannot write a result after the turn ends.
  const mcpAbort = new AbortController();

  // LIFECYCLE MIGRATION, STEP 2. The environment owns what it applied. It is seeded from the
  // request that is building it, because that request IS what this environment installs. Every
  // later change must go through `commitApplied`, and only after the change succeeds.
  const applied = appliedStateForRequest(request);

  const environment: SessionEnvironment = {
    get appliedState() {
      return applied.appliedState;
    },
    commitApplied: (result) => applied.commitApplied(result),
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
    executableToolGateRef,
    mcpAbort,
    runAgentDir,
    otlpAuthFilePath,
    codexSqliteHome,
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
    installedMountExpiries: {},
    durableCwdSafeToDelete: true,
    // Local runs get a plain rmSync cleanup for the throwaway cwd; Daytona has none on this host.
    workspace: plan.isDaytona
      ? undefined
      : {
          cleanup: async () =>
            rmSync(plan.workspace.cwd, { recursive: true, force: true }),
        },
    runtimeRemount: undefined,
    closeToolMcp: undefined,
    currentTurn: undefined,
    lastTurnToolCallIds: [],
    parkedApprovals: new Map(),
    parkedApproval: undefined,
    approvalGateCount: 0,
    nonParkablePauseCount: 0,
    destroyed: false,
    destroy: async () => {},
    clearTurn: () => {},
  };

  environment.clearTurn = () => {
    environment.currentTurn = undefined;
  };

  return {
    ok: true as const,
    acquireStartedAt,
    agentMountDir,
    artifactId,
    binaryPath,
    deferredClientToolRelay,
    deferredExecutableToolGate,
    env,
    environment,
    localBuiltinGatingUnenforceable,
    logger,
    localModelConfigUnwritable,
    localModelOverrideUnenforceable,
    localPiAgentDirUnwritable,
    mcpAbort,
    piExtEnv,
    piModelConfig,
    piModelConfigError,
    piSessionDir,
    piSkillSnapshot,
    plan,
    runAgentDir,
    runCred,
    sessionForMount,
    signAgentMount,
    signMount,
    strictModel,
    timingLog,
  };
}
