import { rmSync } from "node:fs";

import { apiBase } from "../../apiBase.ts";

import {
  resolveRunSessionId,
  type AgentRunRequest,
} from "../../protocol.ts";
import { type ClientToolOutcome } from "../../responder.ts";
import type { ClientToolRelay } from "../../tools/client-tool-relay.ts";
import {
  agentMountPath,
  signAgentMountCredentials,
} from "./agent-mount.ts";
import { createToolCallCorrelationIndex } from "./client-tools.ts";
import { buildDaemonEnv, resolveDaemonBinary } from "./daemon.ts";
import { conciseError } from "./errors.ts";
import {
  signSessionMountCredentials,
  type MountCredentials,
} from "./mount.ts";
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
  type PiModelConfigPlan,
} from "./pi-model-config.ts";
import { buildRunPlan } from "./run-plan.ts";
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
    const clientTools = plan.toolSpecs
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
  let piModelConfig: PiModelConfigPlan | undefined;
  let piModelConfigError: Error | undefined;
  if (plan.isPi) {
    try {
      piModelConfig = buildPiModelConfigPlan(request, plan.secrets);
    } catch (err) {
      piModelConfigError = err as Error;
    }
  }
  if (piModelConfig) {
    logger(
      `pi model-config plan provider=${piModelConfig.providerId} api=${piModelConfig.api} ` +
        `model=${piModelConfig.models.map((m) => m.id).join(",")}`,
    );
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

  return {
    ok: true as const,
    acquireStartedAt,
    agentMountDir,
    artifactId,
    binaryPath,
    deferredClientToolRelay,
    env,
    environment,
    localBuiltinGatingUnenforceable,
    logger,
    localModelConfigUnwritable,
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
