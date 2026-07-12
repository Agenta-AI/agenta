import { rmSync } from "node:fs";

import { apiBase } from "../../apiBase.ts";


import {
resolveRunSessionId,
type AgentRunRequest
} from "../../protocol.ts";
import {
type ClientToolOutcome
} from "../../responder.ts";
import type { ClientToolRelay } from "../../tools/client-tool-relay.ts";
import {
createToolCallCorrelationIndex
} from "./client-tools.ts";
import { buildDaemonEnv,resolveDaemonBinary } from "./daemon.ts";
import { conciseError } from "./errors.ts";
import {
signSessionMountCredentials,
type MountCredentials
} from "./mount.ts";
import {
buildPiExtensionEnv,
prepareLocalPiAssets,
writeOtlpAuthFile,
} from "./pi-assets.ts";
import {
buildRunPlan
} from "./run-plan.ts";
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
import {
assertLocalRunnerOwnership
} from "./session-continuity.ts";
import { resolvesToLocalProvider } from "./session-identity.ts";

function defaultLog(message: string): void {
  process.stderr.write(`[sandbox-agent] ${message}\n`);
}

export async function prepareEnvironmentSetup(
  request: AgentRunRequest,
  deps: SandboxAgentDeps,
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

  // Derive the durable cwd from the sign prefix (one source of truth, both providers).
  // local: /tmp/agenta/<prefix>  —  daytona: /home/sandbox/agenta/<prefix>
  // <prefix> is already "mounts/<project_id>/<mount_id>", so no extra slug is needed.
  let durableCwd: string | undefined;
  if (mountCreds?.prefix) {
    const isDaytonaReq =
      (request.sandbox ?? process.env.SANDBOX_AGENT_PROVIDER ?? "local") ===
      "daytona";
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
  if (!planResult.ok) {
    return { ok: false as const, error: planResult.error };
  }
  const plan = planResult.plan;

  // Clear-then-apply (Security rule 5): on a managed run (credentialMode "env") the daemon
  // inherits NONE of the sidecar's own provider keys, so only the resolved `plan.secrets` are
  // present and an inherited key for another provider cannot leak. For runtime_provided/none/
  // un-migrated runs the harness uses its own login, so the inherited keys stay.
  const clearProviderEnv = plan.credentialMode === "env";
  const env = (deps.buildDaemonEnv ?? buildDaemonEnv)(plan.acpAgent, {
    clearProviderEnv,
  });
  Object.assign(env, plan.secrets); // apply only the resolved provider keys
  applyClaudeConnectionEnv(env, request, plan.acpAgent, logger);
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
  const runAgentDir = prepareLocalPiAssets({ plan, env, log: logger });

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
    mountProjectId: mountCreds?.projectId,
    loadedFromContinuity: false,
    resumable: false,
    continuityTurnIndex: undefined,
    sessionDestroyRequested: false,
    mountedCwd: undefined,
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
    binaryPath,
    deferredClientToolRelay,
    env,
    environment,
    logger,
    mcpAbort,
    piExtEnv,
    plan,
    runCred,
    sessionForMount,
    signMount,
    strictModel,
    timingLog,
  };
}
