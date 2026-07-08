/**
 * WP-8 sandbox-agent harness driver.
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
import { rmSync } from "node:fs";

import { apiBase } from "../apiBase.ts";

import { SandboxAgent, InMemorySessionPersistDriver } from "sandbox-agent";

import {
  createSandboxAgentOtel,
  TOOL_NOT_EXECUTED_PAUSED,
} from "../tracing/otel.ts";
import {
  localRelayHost,
  sandboxRelayHost,
  startToolRelay,
  type RelayPermissions,
} from "../tools/relay.ts";
import {
  ApprovalResponder,
  ConversationDecisions,
  extractApprovalDecisions,
  extractClientToolOutputs,
  type ClientToolOutcome,
  type Responder,
} from "../responder.ts";
import type { ClientToolRelay } from "../tools/client-tool-relay.ts";
import {
  buildClientToolRelay,
  createToolCallCorrelationIndex,
} from "./sandbox_agent/client-tools.ts";
import {
  type AgentRunRequest,
  type AgentRunResult,
  type EmitEvent,
  type HarnessCapabilities,
  type ToolCallbackContext,
  type ToolPermission,
  resolvePromptText,
  resolveRunSessionId,
} from "../protocol.ts";
import {
  assert,
  assertRequiredCapabilities,
  probeCapabilities,
} from "./sandbox_agent/capabilities.ts";
import { createAcpFetch } from "./sandbox_agent/acp-fetch.ts";
import { buildDaemonEnv, resolveDaemonBinary } from "./sandbox_agent/daemon.ts";
import {
  createCookieFetch,
  prepareDaytonaPiAssets,
} from "./sandbox_agent/daytona.ts";
import { conciseError } from "./sandbox_agent/errors.ts";
import { buildSessionMcpServers } from "./sandbox_agent/mcp.ts";
import { applyModel } from "./sandbox_agent/model.ts";
import { findSwallowedPiError } from "./sandbox_agent/pi-error.ts";
import {
  buildPiExtensionEnv,
  prepareLocalPiAssets,
  writeOtlpAuthFile,
} from "./sandbox_agent/pi-assets.ts";
import {
  decide,
  PendingApprovalLatch,
  permissionsFromRequest,
} from "../permission-plan.ts";
import { attachPermissionResponder } from "./sandbox_agent/acp-interactions.ts";
import {
  PAUSED,
  PendingApprovalPauseController,
} from "./sandbox_agent/pause.ts";
import {
  createRunLimits,
  resolveRunLimits,
} from "./sandbox_agent/run-limits.ts";
import {
  createInteraction,
  resolveInteraction,
  buildWorkflowReferences,
} from "../sessions/interactions.ts";
import { buildSandboxProvider } from "./sandbox_agent/provider.ts";
import {
  buildRunPlan,
  type BuildRunPlanDeps,
  type RunPlan,
} from "./sandbox_agent/run-plan.ts";
import { priorMessages } from "./sandbox_agent/transcript.ts";
import { resolveRunUsage } from "./sandbox_agent/usage.ts";
import { prepareWorkspace } from "./sandbox_agent/workspace.ts";
import {
  signSessionMountCredentials,
  mountStorage,
  mountStorageRemote,
  unmountStorage,
  discoverTunnelEndpoint,
  type MountCredentials,
} from "./sandbox_agent/mount.ts";

export {
  buildTurnText,
  messageTranscript,
} from "./sandbox_agent/transcript.ts";
export { toAcpMcpServers } from "./sandbox_agent/mcp.ts";

function log(message: string): void {
  process.stderr.write(`[sandbox-agent] ${message}\n`);
}

/** Extract the run credential from the OTLP export headers (initial value, constant for the run). */
function runCredential(request: AgentRunRequest): string {
  const headers = (request.telemetry?.exporters?.otlp?.headers ?? {}) as Record<
    string,
    string
  >;
  return (headers["authorization"] ?? headers["Authorization"] ?? "").trim();
}

function serverPermissionsFromRequest(
  request: AgentRunRequest,
): ReadonlyMap<string, ToolPermission> {
  const permissions = new Map<string, ToolPermission>();
  for (const server of request.mcpServers ?? []) {
    if (server.permission !== undefined) {
      permissions.set(server.name, server.permission);
    }
  }
  return permissions;
}

type Log = (message: string) => void;
const LOCAL_DURABLE_CWD_ENOTCONN_REMOUNT_LIMIT = 1;

// In-flight sandbox handles, by run. The per-run `finally` deletes the sandbox on every normal /
// error / client-disconnect path, but a process KILL (docker stop / SIGTERM / OOM mid-run) skips
// the `finally` entirely — so a shutdown signal handler (see `server.ts`) drains this set to
// best-effort delete any still-running sandbox before exit. Remote (Daytona) sandboxes also carry
// the auto-stop backstop in `provider.ts` for the cases a signal can never reach (SIGKILL/OOM).
const inFlightSandboxes = new Set<{
  destroySandbox?: () => Promise<unknown>;
}>();

/**
 * Best-effort delete every sandbox currently mid-run, bounded so it can never hang shutdown.
 * Called from the process signal handler so `docker stop` reaps remote sandboxes instead of
 * leaking them. Each delete is independent and its own failure is swallowed; the whole sweep is
 * raced against `timeoutMs` so a slow Daytona API call cannot block the exit.
 */
export async function destroyInFlightSandboxes(
  timeoutMs = 5000,
): Promise<void> {
  const pending = [...inFlightSandboxes];
  if (pending.length === 0) return;
  const sweep = Promise.allSettled(
    pending.map((sandbox) =>
      Promise.resolve(sandbox.destroySandbox?.()).catch(() => {}),
    ),
  );
  await Promise.race([
    sweep,
    new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
  ]);
}

function shouldSuppressPausedToolCallUpdate(
  update: unknown,
  pause: PendingApprovalPauseController,
): boolean {
  const frame = update as
    { sessionUpdate?: unknown; toolCallId?: unknown } | undefined;
  const kind = frame?.sessionUpdate;
  if (kind !== "tool_call" && kind !== "tool_call_update") return false;
  const toolCallId =
    typeof frame?.toolCallId === "string" ? frame.toolCallId : undefined;
  return pause.isPausedToolCall(toolCallId);
}

const CLAUDE_STRICT_DEPLOYMENTS = new Set([
  "custom",
  "bedrock",
  "vertex",
  "vertex_ai",
]);

function applyClaudeConnectionEnv(
  env: Record<string, string>,
  request: AgentRunRequest,
  acpAgent: string,
  logger: Log,
): boolean {
  if (acpAgent !== "claude") return false;

  // Disable the Claude Agent SDK's Tool-Search feature for every Claude run. The bundled
  // SDK defaults Tool-Search ON, which makes Claude DEFER the `agenta-tools` MCP tools and
  // call them before their `inputSchema` is loaded — so it emits an empty `input: {}` and
  // tools-with-args (reference workflows, commit_revision) never receive their arguments.
  // Our tool count is small, so deferral buys nothing and only strips the schema. The SDK
  // treats only `false`/`0`/`no`/`off` as off, so the string must be "false" (not "0"/"100").
  // This is applied after `buildDaemonEnv`'s clear and is not in `KNOWN_PROVIDER_ENV_VARS`,
  // so it is never stripped, and it reaches the Daytona sandbox like `ANTHROPIC_BASE_URL`.
  env.ENABLE_TOOL_SEARCH = "false";

  const deployment = request.deployment;
  const selectedModel = request.model;
  const baseUrl = request.endpoint?.baseUrl;
  if (baseUrl) {
    env.ANTHROPIC_BASE_URL = baseUrl;
    logger(`claude base_url: ${baseUrl}`);
  }

  if (deployment === "bedrock") {
    env.CLAUDE_CODE_USE_BEDROCK = "1";
    const region = request.endpoint?.region;
    if (region) {
      env.AWS_REGION = region;
      env.AWS_DEFAULT_REGION ??= region;
    }
  } else if (deployment === "vertex" || deployment === "vertex_ai") {
    env.CLAUDE_CODE_USE_VERTEX = "1";
  }

  if (
    selectedModel &&
    (baseUrl || (deployment && CLAUDE_STRICT_DEPLOYMENTS.has(deployment)))
  ) {
    env.ANTHROPIC_MODEL = selectedModel;
    env.ANTHROPIC_CUSTOM_MODEL_OPTION = selectedModel;
    logger(
      `claude model=${selectedModel} deployment=${deployment ?? "<none>"}`,
    );
    return true;
  }
  return false;
}

export interface SandboxAgentDeps extends BuildRunPlanDeps {
  startSandboxAgent?: typeof SandboxAgent.start;
  createPersist?: () => InMemorySessionPersistDriver;
  createOtel?: typeof createSandboxAgentOtel;
  buildDaemonEnv?: typeof buildDaemonEnv;
  resolveDaemonBinary?: typeof resolveDaemonBinary;
  buildSandboxProvider?: typeof buildSandboxProvider;
  createCookieFetch?: typeof createCookieFetch;
  createAcpFetch?: typeof createAcpFetch;
  prepareWorkspace?: typeof prepareWorkspace;
  probeCapabilities?: typeof probeCapabilities;
  applyModel?: typeof applyModel;
  startToolRelay?: typeof startToolRelay;
  localRelayHost?: typeof localRelayHost;
  sandboxRelayHost?: typeof sandboxRelayHost;
  signSessionMountCredentials?: typeof signSessionMountCredentials;
  mountStorage?: typeof mountStorage;
  mountStorageRemote?: typeof mountStorageRemote;
  unmountStorage?: typeof unmountStorage;
  discoverTunnelEndpoint?: typeof discoverTunnelEndpoint;
  responderFactory?: (request: AgentRunRequest) => Responder;
  resolveRunLimits?: typeof resolveRunLimits;
  createRunLimits?: typeof createRunLimits;
  log?: Log;
}

function isTransportEndpointDisconnected(err: unknown): boolean {
  const message = String(err instanceof Error ? err.message : err);
  const code =
    typeof err === "object" && err !== null && "code" in err
      ? String((err as { code?: unknown }).code)
      : "";
  return (
    code === "ENOTCONN" ||
    message.includes("ENOTCONN") ||
    message.includes("Transport endpoint is not connected")
  );
}

function containsTransportEndpointDisconnected(value: unknown): boolean {
  const seen = new Set<object>();

  const visit = (current: unknown): boolean => {
    if (typeof current === "string") {
      return isTransportEndpointDisconnected(current);
    }
    if (current instanceof Error) {
      return isTransportEndpointDisconnected(current);
    }
    if (!current || typeof current !== "object") {
      return false;
    }
    if (seen.has(current)) {
      return false;
    }
    seen.add(current);

    const code =
      "code" in current ? String((current as { code?: unknown }).code) : "";
    if (code === "ENOTCONN") {
      return true;
    }

    if (Array.isArray(current)) {
      return current.some(visit);
    }
    return Object.values(current as Record<string, unknown>).some(visit);
  };

  return visit(value);
}

/**
 * Race sentinel: a run-limits deadline (total/idle/TTFB/per-tool-call) tripped mid-turn. Distinct
 * from `PAUSED` so the prompt race can tell a human pause (keep the session) from a wedge deadline
 * (end the turn as an error, letting the caller's teardown reclaim the sandbox).
 */
const RUN_LIMIT_TRIPPED = Symbol("run-limit-tripped");

/**
 * The per-turn sink the session-lifetime listeners demux into. `runTurn` swaps a fresh one in
 * at turn start (`env.currentTurn`) and the dispatch clears it at turn end. The `sandbox-agent`
 * listener registries are plain Sets — an event with no listener is dropped and a permission
 * request with no listener is CANCELLED — so the listeners stay attached for the session's whole
 * life and route into whichever turn is active, with no detach/attach window between turns.
 */
interface CurrentTurn {
  run: ReturnType<typeof createSandboxAgentOtel>;
  pause: PendingApprovalPauseController;
  toolRelay?: { stop: () => Promise<void> };
  /** Route a session/update for the active turn (suppress + handleUpdate + pause re-sweep). */
  handleUpdate: (update: unknown) => void;
  /** Route a permission reverse-RPC for the active turn (built by attachPermissionResponder). */
  onPermissionRequest?: (req: unknown) => void;
}

/**
 * A Claude ACP permission gate that paused the turn and can be answered later on the SAME live
 * session (slice 2 keep-alive). Recorded ONLY for a harness ACP permission gate (never a Pi relay
 * gate, a Pi builtin gate, or a client-tool MCP pause — those cannot be answered across a turn
 * boundary and stay on the cold path). Existence of this record is what makes the dispatch park a
 * paused session in `awaiting_approval` instead of tearing it down.
 */
export interface ParkedApproval {
  /** Marks the pending-gate shape; the dispatch treats any other shape as a cold-fallback. */
  gateType: "claude-acp-permission";
  /** The ACP permission-request id, answered later via `session.respondPermission`. */
  permissionId: string;
  /** The gated tool call's id — matched against the incoming approval envelope's toolCallId. */
  toolCallId: string;
  /** The gated tool name (logging + the durable interaction row); never its args, in logs. */
  toolName: string | undefined;
  /** The gated call's original args, used to seed the resume turn's trace/egress tool span. */
  args: unknown;
  /** The durable interaction row token, resolved on the answer via the onResolveInteraction hook. */
  interactionToken: string;
  /** The held original `prompt()` promise; the resume awaits it after `respondPermission`. */
  promptPromise?: Promise<unknown>;
}

/** Answer a parked Claude ACP permission gate on the live session (the keep-alive resume input). */
export interface ResumeApprovalInput {
  permissionId: string;
  reply: "once" | "reject";
  toolCallId: string;
  toolName: string | undefined;
  args: unknown;
  interactionToken: string;
  promptPromise?: Promise<unknown>;
}

/** Per-turn options for `runTurn`. Absent (flag off / cold) means today's byte-identical path. */
export interface RunTurnOptions {
  /** A live continuation: send only the new user text instead of the full cold transcript. */
  continuation?: boolean;
  /**
   * Keep-alive approval park mode: on a Claude ACP permission gate the pause keeps the session
   * alive (no settle/abort/destroy) so a later resume can answer it. A non-parkable pause (Pi
   * relay, client tool) still tears down exactly as today, so this is safe to set on any eligible
   * keep-alive turn.
   */
  approvalParkMode?: boolean;
  /** A live approval resume: answer the parked gate and stream the continued prompt's events. */
  resume?: ResumeApprovalInput;
}

/**
 * A session-scoped environment that can serve many turns. Everything expensive to build lives
 * here (sandbox, session, internal tool-MCP server, mounted cwd, relay/temp dirs); `destroy()`
 * is the one complete idempotent teardown the pool, the shutdown handler, and the cold path all
 * call. Per-turn state rides `currentTurn`, swapped in by `runTurn`.
 */
export interface SessionEnvironment {
  plan: RunPlan;
  logger: Log;
  deps: SandboxAgentDeps;
  sandbox: any;
  session: any;
  sessionId: string;
  model: string | undefined;
  capabilities: HarnessCapabilities;
  strictModel: boolean;
  toolCallIndex: ReturnType<typeof createToolCallCorrelationIndex>;
  /** The current turn's client-tool relay, read by the deferred ref baked into the MCP server. */
  clientToolRelayRef: { current?: ClientToolRelay };
  mcpAbort: AbortController;
  runAgentDir: string | undefined;
  otlpAuthFilePath: string | undefined;
  mountCreds: MountCredentials | null;
  /** The mount's owning project id (keep-alive pool key scope); undefined when there is no mount. */
  mountProjectId?: string;
  // Mutable teardown/turn state shared across acquire, runTurn, and destroy.
  sessionDestroyRequested: boolean;
  mountedCwd: string | undefined;
  durableCwdSafeToDelete: boolean;
  workspace: { cleanup: () => Promise<void> } | undefined;
  runtimeRemount: Promise<boolean> | undefined;
  closeToolMcp: (() => Promise<void>) | undefined;
  currentTurn?: CurrentTurn;
  /**
   * The unique ACP tool-call ids the LAST completed turn emitted (reset at each turn start).
   * The keep-alive dispatch folds them into the expected next-history fingerprint at park time,
   * so a tool-using turn still matches its own continuation (the FE keeps assistant tool parts).
   */
  lastTurnToolCallIds: string[];
  /**
   * The Claude ACP permission gate the LAST turn paused on (slice 2), or undefined. Set only for a
   * harness ACP permission gate, reset at each turn start; the dispatch reads it after a paused
   * turn to decide whether to park in `awaiting_approval` and, on the next request, how to resume.
   */
  parkedApproval?: ParkedApproval;
  /**
   * How many Claude ACP permission gates resolved to pendingApproval THIS turn (reset at turn
   * start). More than one means parallel gates the single-gate resume cannot answer, so the
   * dispatch does not park (tears down cold as today).
   */
  approvalGateCount: number;
  destroyed: boolean;
  /** Complete, idempotent teardown (all the finalizers the old per-run `finally` ran). */
  destroy: () => Promise<void>;
  /** End the active turn: clear the current-turn sink (called before a park). */
  clearTurn: () => void;
}

export type AcquireEnvironmentResult =
  { ok: true; env: SessionEnvironment } | { ok: false; error: string };

/**
 * Sign the session's durable mount up front so keep-alive can build a pool key (the mount's
 * owning `projectId`) and credential epoch without acquiring the whole environment. Returns
 * exactly what the sign yielded: `null` when there is no session/credential to sign with, or
 * the sign returned no usable mount (store unconfigured, 503, ephemeral fallback). The caller
 * threads the result — null included — into `acquireEnvironment` as `presignedMount`, so the
 * mount is signed exactly once per run on every path; a null result additionally means there is
 * NO safe project key and the request must never park.
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
  if (!planResult.ok) return { ok: false, error: planResult.error };
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
  const strictModel = applyClaudeConnectionEnv(
    env,
    request,
    plan.acpAgent,
    logger,
  );
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
        // records which skills loaded (F-029); local Pi self-instruments, so the runner's
        // sandbox-agent otel has no span to stamp here.
        skills: plan.skillDirs.map((s) => s.name),
      })
    : {};
  Object.assign(env, piExtEnv); // local daemon inherits it; daytona gets it via envVars
  logger(
    `tools=${plan.toolSpecs.length} executableTools=${plan.executableToolSpecs.length} ` +
      `piPublicTools=${piExtEnv.AGENTA_AGENT_TOOLS_PUBLIC_SPECS ? "yes" : "no"}`,
  );
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

  const env2: SessionEnvironment = {
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

  env2.clearTurn = () => {
    env2.currentTurn = undefined;
  };

  // The one complete, idempotent teardown — the same steps the old per-run `finally` ran, in the
  // same order. Every resource is null-checked, so it is safe after a partial acquire and safe to
  // call twice (the guard returns on a second call). It must never throw.
  env2.destroy = async () => {
    if (env2.destroyed) return;
    env2.destroyed = true;
    await env2.runtimeRemount?.catch(() => {});
    if (env2.sandbox) inFlightSandboxes.delete(env2.sandbox);
    await env2.currentTurn?.toolRelay?.stop().catch(() => {});
    // Teardown backstop: destroy any in-flight loopback `tools/call` before closing the server.
    env2.mcpAbort.abort();
    await env2.closeToolMcp?.().catch(() => {});
    // Send a graceful `session/cancel` BEFORE tearing down the daemon (the ACP child process
    // leak, dev-box incident 2026-07-06): destroySandbox hard-kills the sandbox-agent server but
    // does not cascade to the ACP adapter subprocess it spawned, which then reparents to PID 1
    // and never exits. Skip if the pause path already sent it (`sessionDestroyRequested`).
    if (env2.session && !env2.sessionDestroyRequested)
      await env2.sandbox?.destroySession?.(env2.session.id).catch(() => {});
    await env2.sandbox?.destroySandbox().catch(() => {});
    await env2.sandbox?.dispose().catch(() => {});
    // Unmount the durable cwd BEFORE removing the dir: data lives in the store, only the host
    // mountpoint is torn down. If unmount is not CONFIRMED gone, skip the delete: rmSync must
    // never run against a possibly-live FUSE mount into the durable store.
    if (env2.mountedCwd) {
      env2.durableCwdSafeToDelete = await (
        env2.deps.unmountStorage ?? unmountStorage
      )(env2.mountedCwd, { log }).catch(() => false);
    }
    if (!env2.durableCwdSafeToDelete) {
      logger(
        `durable cwd unmount not confirmed, skipping workspace cleanup cwd=${plan.cwd}`,
      );
    } else {
      await env2.workspace?.cleanup().catch(() => {});
    }
    // The per-run Agenta agent dir (skills isolation) is throwaway; remove it too.
    if (env2.runAgentDir)
      rmSync(env2.runAgentDir, { recursive: true, force: true });
    // Backstop: the extension deletes this on read; remove it here too in case the harness never
    // started (or crashed before reading it), so the bearer never lingers.
    if (env2.otlpAuthFilePath) rmSync(env2.otlpAuthFilePath, { force: true });
    // Remove the per-run skills temp root the materializer created (success or error).
    plan.skillsCleanup();
  };

  // --- local durable cwd mount helpers (session-scoped, close over env2) ------ //
  const mountLocalDurableCwd = async (reason: string): Promise<boolean> => {
    if (!env2.mountCreds || plan.isDaytona) return false;
    logger(
      `local durable cwd mount (${reason}) session=${sessionForMount} cwd=${plan.cwd}`,
    );
    if (
      await (deps.mountStorage ?? mountStorage)(plan.cwd, env2.mountCreds, {
        log: logger,
      })
    ) {
      env2.mountedCwd = plan.cwd;
      return true;
    }
    return false;
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
    env2.mountCreds = fresh;
    return mountLocalDurableCwd("enotconn-retry");
  };
  const remountLocalCwdAfterRuntimeEnotconn = (event: unknown): void => {
    if (plan.isDaytona || !env2.mountCreds || !env2.mountedCwd) return;
    if (env2.runtimeRemount || !containsTransportEndpointDisconnected(event))
      return;
    logger(
      `local durable cwd ENOTCONN observed in ACP event session=${sessionForMount} cwd=${plan.cwd}; re-signing and remounting`,
    );
    env2.runtimeRemount = reSignAndRemountLocalCwd().catch((err) => {
      logger(
        `local durable cwd runtime remount failed session=${sessionForMount}: ${conciseError(err, plan.harness)}`,
      );
      return false;
    });
  };

  try {
    // Persist events in-process so a follow-up turn can resume by session id.
    const persist =
      deps.createPersist?.() ?? new InMemorySessionPersistDriver();
    const startSandboxAgent =
      deps.startSandboxAgent ??
      ((options: Parameters<typeof SandboxAgent.start>[0]) =>
        SandboxAgent.start(options));
    env2.sandbox = await startSandboxAgent({
      sandbox: (deps.buildSandboxProvider ?? buildSandboxProvider)(
        plan.sandboxId,
        env,
        binaryPath,
        piExtEnv,
        plan.secrets,
        plan.sandboxPermission,
      ),
      persist,
      // Propagate caller cancellation (a client disconnect on the streaming HTTP edge) so an
      // in-flight run aborts instead of finishing unobserved. `destroy` still disposes.
      ...(signal ? { signal } : {}),
      // Long-timeout undici dispatcher so a paused HITL turn is not reaped by undici's default
      // headersTimeout; Daytona additionally carries the per-sandbox auth cookie.
      fetch: plan.isDaytona
        ? (deps.createCookieFetch ?? createCookieFetch)()
        : (deps.createAcpFetch ?? createAcpFetch)(),
    });
    // Track the live handle so a shutdown signal handler can delete it if `destroy` is skipped by
    // a process KILL; removed in `destroy` on every normal exit so it is never double-deleted.
    if (env2.sandbox) inFlightSandboxes.add(env2.sandbox);

    // On Daytona, push the harness login, the extension, and AGENTS.md into the remote sandbox.
    if (plan.isDaytona) {
      await prepareDaytonaPiAssets({
        sandbox: env2.sandbox,
        plan,
        log: logger,
      });
    }

    // Durable cwd: mount BEFORE createSession (so the session opens inside it) and BEFORE
    // workspace materialization (so AGENTS.md, harness files, and skills land in the durable
    // prefix instead of being hidden under the FUSE mount).
    if (env2.mountCreds && !plan.isDaytona) {
      await mountLocalDurableCwd("initial");
    }
    if (env2.mountCreds && plan.isDaytona) {
      const endpoint = await (
        deps.discoverTunnelEndpoint ?? discoverTunnelEndpoint
      )({
        log: logger,
      });
      if (
        endpoint &&
        (await (deps.mountStorageRemote ?? mountStorageRemote)(
          env2.sandbox,
          plan.cwd,
          env2.mountCreds,
          {
            endpoint,
            log: logger,
          },
        ))
      ) {
        logger(`remote durable cwd active for session=${sessionForMount}`);
      }
    }

    try {
      env2.workspace = await (deps.prepareWorkspace ?? prepareWorkspace)({
        sandbox: env2.sandbox,
        plan,
        log: logger,
      });
    } catch (err) {
      if (
        !plan.isDaytona &&
        env2.mountCreds &&
        isTransportEndpointDisconnected(err) &&
        (await reSignAndRemountLocalCwd())
      ) {
        logger(
          `retrying workspace preparation after local durable cwd remount`,
        );
        env2.workspace = await (deps.prepareWorkspace ?? prepareWorkspace)({
          sandbox: env2.sandbox,
          plan,
          log: logger,
        });
      } else {
        throw err;
      }
    }

    // Sandbox-start invariant: `startSandboxAgent` must hand back a usable handle.
    assert(
      env2.sandbox && typeof env2.sandbox.createSession === "function",
      `sandbox provider '${plan.sandboxId}' returned no usable sandbox handle`,
    );

    // Probe what this harness supports and branch on capabilities, not on the harness name.
    const probed = await (deps.probeCapabilities ?? probeCapabilities)(
      env2.sandbox,
      plan.acpAgent,
    );
    const capabilities = probed.capabilities;
    env2.capabilities = capabilities;

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
      log: logger,
    });
    // Close the internal gateway-tool MCP server (if one started) when the session is destroyed.
    env2.closeToolMcp = sessionMcp.close;

    env2.session = await env2.sandbox.createSession({
      agent: plan.acpAgent,
      cwd: plan.cwd,
      sessionInit: { cwd: plan.cwd, mcpServers: sessionMcp.servers },
    });
    env2.sessionId = resolveRunSessionId(request, env2.session.id);

    // Resolve the model first: when the harness rejects the requested id and keeps its own
    // default, `model` is undefined and the chat span is labelled "chat".
    env2.model = await (deps.applyModel ?? applyModel)(
      env2.session,
      request.model,
      logger,
      { strict: strictModel },
    );

    // Session-lifetime listeners: attach ONCE, demux into the active turn's sink. Non-throwing
    // (the sandbox-agent registries are plain Sets; a thrown handler would corrupt the stream).
    // Deliberate divergence from the old inline handler: a handler throw is swallowed + logged
    // here instead of propagating, because the listener now outlives any single turn.
    env2.session.onEvent((event: any) => {
      try {
        remountLocalCwdAfterRuntimeEnotconn(event);
        const payload = event?.payload;
        const update = payload?.params?.update ?? payload?.update;
        if (!update) return;
        // Record live ACP tool_call ids so a paused client_tool can correlate to Claude's bubble
        // (session-scoped; a lookup CONSUMES its matched id).
        env2.toolCallIndex.record(update);
        const turn = env2.currentTurn;
        if (turn) {
          turn.handleUpdate(update);
        } else {
          // Between turns (parked/idle): no turn owns this event. Log and drop by decision.
          logger(`[keepalive] between-turns event dropped`);
        }
      } catch (err) {
        logger(
          `session onEvent handler error: ${conciseError(err, plan.harness)}`,
        );
      }
    });
    env2.session.onPermissionRequest((req: any) => {
      try {
        const turn = env2.currentTurn;
        if (turn?.onPermissionRequest) {
          turn.onPermissionRequest(req);
          return;
        }
        // Between turns: no turn owns this gate. A slice-2 approval park is recorded DURING the
        // active turn (the gate fires while a prompt runs, routing through currentTurn), and a
        // parked-on-approval session leaves its harness suspended on that gate — so nothing new
        // fires here while parked. A gate that reaches this handler is therefore a genuine stray
        // (e.g. a late teardown artifact): cancel by policy so it cannot hang.
        logger(
          `[keepalive] between-turns permission request, cancelling by policy id=${req?.id}`,
        );
        void Promise.resolve(
          env2.session?.respondPermission?.(req?.id, "reject"),
        ).catch(() => {});
      } catch (err) {
        logger(
          `session onPermissionRequest handler error: ${conciseError(err, plan.harness)}`,
        );
      }
    });

    return { ok: true, env: env2 };
  } catch (err) {
    const error = conciseError(err, plan.harness, request.provider);
    // Mirror today's shared teardown: no otel exists yet during acquire, so there is no partial
    // trace to flush — just run the incrementally-registered finalizers and surface the error.
    await env2.destroy();
    return { ok: false, error };
  }
}

/**
 * Run one turn against an acquired environment: start a fresh otel run, wire this turn's pause
 * controller / latch / decisions / responder into `env.currentTurn`, restart the tool relay,
 * send the prompt, resolve usage, and finish + flush the trace. It does NOT tear down the
 * environment (the caller owns `env.destroy`). On a continuation the prompt is only the new user
 * text (`buildTurnText` does not run); on a cold turn it is `plan.turnText`, exactly as before.
 */
export async function runTurn(
  env: SessionEnvironment,
  request: AgentRunRequest,
  emit?: EmitEvent,
  signal?: AbortSignal,
  opts: RunTurnOptions = {},
): Promise<AgentRunResult> {
  const { plan, logger, deps } = env;
  const sessionId = env.sessionId;
  // Reset the per-turn tool-call id record (the park folds the completed turn's ids into the
  // expected next-history fingerprint).
  env.lastTurnToolCallIds = [];
  // Reset the per-turn approval-park bookkeeping. A fresh turn starts with no parked gate; this
  // turn re-records it only if it pauses on a Claude ACP permission gate. (The dispatch has
  // already captured any prior park into `opts.resume` before calling us.)
  env.parkedApproval = undefined;
  env.approvalGateCount = 0;
  // Hoisted so the catch can flush a partial trace (mirroring the pre-split `otel?` handling —
  // a createOtel throw must still return `{ ok: false }`, not propagate raw) and the finally can
  // stop this turn's relay on EVERY exit path (a cleared sink must never orphan it).
  let otel: ReturnType<typeof createSandboxAgentOtel> | undefined;
  let activeTurn: CurrentTurn | undefined;

  // Time-based run deadlines (total/idle/TTFB/per-tool-call) for THIS turn: an idle/wedged harness
  // has no deadline anywhere, so a silent or hung turn would hold its sandbox forever. Tripping a
  // limit resolves the prompt race with `RUN_LIMIT_TRIPPED`, which ends the turn as an error so the
  // caller's teardown (`runSandboxAgent`'s `finally`, or the keep-alive dispatch's evict-on-failure)
  // reclaims the sandbox exactly as any other error does. Disposed in the `finally` on every path.
  // A human pause retires the deadlines (`notePaused`): a HITL wait is legitimate, not a wedge.
  const runLimits = (deps.createRunLimits ?? createRunLimits)(
    (deps.resolveRunLimits ?? resolveRunLimits)(logger),
    { log: logger },
  );
  let runLimitTrip: (() => void) | undefined;
  let runLimitReason: string | undefined;
  const runLimitTripped = new Promise<void>((resolve) => {
    runLimitTrip = resolve;
  });
  runLimits.onTrip((reason) => {
    runLimitReason = reason;
    runLimitTrip?.();
  });

  try {
    const promptText = resolvePromptText(request);
    // Cold: replay the full transcript (plan.turnText). Continuation: only the new user text.
    const turnText = opts.continuation ? promptText : plan.turnText;

    const run = (deps.createOtel ?? createSandboxAgentOtel)({
      harness: plan.harness,
      model: env.model,
      skills: plan.skillDirs.map((s) => s.name),
      traceparent: request.context?.propagation?.traceparent,
      baggage: request.context?.propagation?.baggage,
      endpoint: request.telemetry?.exporters?.otlp?.endpoint,
      authorization: request.telemetry?.exporters?.otlp?.headers?.authorization,
      captureContent: request.telemetry?.capture?.content?.enabled,
      emitSpans: !plan.isPi || plan.isDaytona,
      // Every emitted event is a progress signal for the idle/TTFB deadlines (message/thought
      // deltas, tool calls and results, usage, ...) — the one seam every harness's output flows
      // through. Per-tool-call timers are driven separately from `handleUpdate` below.
      emit: emit && runLimits.wrapEmit(emit),
    });
    otel = run;

    run.start({
      prompt: promptText,
      sessionId,
      messages: [
        ...priorMessages(request),
        { role: "user", content: promptText },
      ],
    });

    const pause = new PendingApprovalPauseController(() => {
      // The F-024 sibling settle runs UNCONDITIONALLY, park mode or not: latch-loser tool calls
      // announced before the winning gate can never execute this turn, and skipping the settle
      // here would leave them as orphaned open parts whenever the dispatch later refuses the park
      // (multi-gate, pool full) — `env.destroy()` does not re-run it. The exclusion keeps the
      // gated (paused) call itself open, so the live resume is untouched.
      run.settleOpenToolCalls(
        (id) => pause.isPausedToolCall(id),
        TOOL_NOT_EXECUTED_PAUSED,
      );
      // Slice 2 park mode: a parkable Claude ACP permission gate recorded `env.parkedApproval`
      // BEFORE firing this pause (the onUserApprovalGate hook runs before the single-pause latch).
      // Keep the live session — the gated tool runs on the resume — so skip ONLY the mcpAbort and
      // the destroySession. The teardown is not lost: the dispatch either parks the session or,
      // if it decides not to (multi-gate, pool full), calls `env.destroy()` which runs them. A
      // non-parkable pause (flag off, Pi relay/builtin gate, client tool) never records
      // `parkedApproval`, so it still tears down here exactly as today.
      if (opts.approvalParkMode && env.parkedApproval) return;
      // Abort any in-flight loopback `tools/call` (a paused Claude client tool) BEFORE the
      // session teardown, so its handler cannot write a result after the turn ends.
      env.mcpAbort.abort();
      env.sessionDestroyRequested = true;
      return env.sandbox.destroySession?.(env.session.id);
    });
    // A human pause resolves this signal exactly once, the moment the turn parks for input — the one
    // place every pause path converges, so the one place to retire the run-limits deadlines for good.
    void pause.signal.then(() => runLimits.notePaused());

    // Publish this turn's sink so the session-lifetime listeners route into it. handleUpdate
    // reproduces the old per-event routing (suppress paused frames, handleUpdate, pause re-sweep).
    const turn: CurrentTurn = {
      run,
      pause,
      toolRelay: undefined,
      handleUpdate: (update) => {
        // Per-tool-call deadline: starts on the announcement, ends on a terminal status. Tracked
        // regardless of the pause-suppression below (a call already timed out must not linger just
        // because a later sibling frame gets suppressed).
        const rawFrame = update as {
          sessionUpdate?: unknown;
          toolCallId?: unknown;
          status?: unknown;
        };
        if (rawFrame?.sessionUpdate === "tool_call" && rawFrame.toolCallId) {
          runLimits.noteToolCallStart(String(rawFrame.toolCallId));
        } else if (
          rawFrame?.sessionUpdate === "tool_call_update" &&
          rawFrame.toolCallId &&
          (rawFrame.status === "completed" || rawFrame.status === "failed")
        ) {
          runLimits.noteToolCallEnd(String(rawFrame.toolCallId));
        }
        if (!shouldSuppressPausedToolCallUpdate(update, pause)) {
          // Record the emitted tool-call ids (unique, first-seen order): the park folds them
          // into the expected next-history fingerprint so a tool-using turn continues live.
          const frame = update as {
            sessionUpdate?: unknown;
            toolCallId?: unknown;
          };
          if (
            frame?.sessionUpdate === "tool_call" &&
            typeof frame.toolCallId === "string" &&
            frame.toolCallId &&
            !env.lastTurnToolCallIds.includes(frame.toolCallId)
          ) {
            env.lastTurnToolCallIds.push(frame.toolCallId);
          }
          run.handleUpdate(update);
          // A sibling announced AFTER the pause won the latch can never execute; settle it
          // immediately so the client never holds an orphaned part (idempotent re-sweep).
          if (pause.active) {
            run.settleOpenToolCalls(
              (id) => pause.isPausedToolCall(id),
              TOOL_NOT_EXECUTED_PAUSED,
            );
          }
        }
      },
      onPermissionRequest: undefined,
    };
    activeTurn = turn;
    env.currentTurn = turn;

    const permissionPlan = permissionsFromRequest(request);
    const storedDecisionMap = extractApprovalDecisions(request);
    if (storedDecisionMap.size > 0) {
      logger(
        `[HITL] resume state: decisions=${JSON.stringify([...storedDecisionMap.keys()])}`,
      );
    }
    const decisions = new ConversationDecisions(
      storedDecisionMap,
      extractClientToolOutputs(request),
    );
    const latch = new PendingApprovalLatch();
    const responder =
      deps.responderFactory?.(request) ??
      new ApprovalResponder(permissionPlan, decisions, logger);
    // Every pause seeds the durable interactions plane, whichever gate paused.
    const recordPendingInteraction = (
      token: string,
      toolName: string | undefined,
      toolArgs: unknown,
      kind: "user_approval" | "client_tool" = "user_approval",
    ): void => {
      const cred = runCredential(request);
      if (!cred) return;
      const references = buildWorkflowReferences(request.runContext?.workflow);
      if (!references?.workflow_revision) return;
      void createInteraction(
        sessionId,
        request.turnId ?? "",
        token,
        kind,
        { request: { tool: toolName ?? token, args: toolArgs }, references },
        () => cred,
      );
    };
    // Transition the durable interaction row to resolved once its gate is answered. Used both by
    // the cold decision-map path (via attachPermissionResponder) and the live approval resume,
    // which answers the parked gate directly. It mirrors the cold path's ordering against
    // `cancelStaleInteractions` (server.ts): that sweep cancels only PENDING gates of OTHER turns,
    // and by resume time the human already marked this gate responded, so it is spared here too.
    const resolveInteractionToken = (token: string): void => {
      const cred = runCredential(request);
      if (!cred) return;
      if (
        !buildWorkflowReferences(request.runContext?.workflow)
          ?.workflow_revision
      )
        return;
      void resolveInteraction(sessionId, token, () => cred);
    };
    // Exactly one gate per call: the harness gate on Claude, the relay on Pi.
    const relayPermissions: RelayPermissions = {
      enforce: plan.isPi,
      decide: (gate) => decide(gate, permissionPlan, decisions),
      onPendingApproval: ({ toolCallId, toolName, args }) => {
        if (!latch.tryAcquire()) return { emitted: false };
        pause.markPausedToolCall(toolCallId);
        run.emitEvent({
          type: "interaction_request",
          id: toolCallId,
          kind: "user_approval",
          payload: {
            toolCallId,
            toolCall: {
              toolCallId,
              name: toolName,
              title: toolName,
              rawInput: args,
              input: args,
            },
            availableReplies: ["once", "reject"],
          },
        });
        recordPendingInteraction(toolCallId, toolName, args);
        pause.pause();
        return { emitted: true };
      },
    };
    const serverPermissions = serverPermissionsFromRequest(request);
    // Build the per-turn permission handler WITHOUT attaching to the live session: the
    // session-lifetime `onPermissionRequest` (in acquireEnvironment) routes into it via
    // `currentTurn`. A capturing shim reuses attachPermissionResponder unchanged; its
    // respondPermission delegates to the real session.
    attachPermissionResponder({
      session: {
        onPermissionRequest: (handler: (req: unknown) => void) => {
          turn.onPermissionRequest = handler;
        },
        respondPermission: (id: string, reply: string) =>
          env.session.respondPermission(id, reply),
      },
      run,
      responder,
      latch,
      serverPermissions,
      log: logger,
      onPause: () => pause.pause(),
      onPausedToolCall: (id) => pause.markPausedToolCall(id),
      onCreateInteraction: recordPendingInteraction,
      onResolveInteraction: resolveInteractionToken,
      // Slice 2: record the parkable Claude ACP permission gate (only in keep-alive park mode) so
      // the dispatch can resume it live. Fires per pending gate (before the latch) so a parallel
      // gate is counted; the single-gate resume records only the FIRST gate's answer target.
      onUserApprovalGate: opts.approvalParkMode
        ? (info) => {
            env.approvalGateCount += 1;
            if (
              env.approvalGateCount === 1 &&
              info.permissionId &&
              info.toolCallId
            ) {
              env.parkedApproval = {
                gateType: "claude-acp-permission",
                permissionId: info.permissionId,
                toolCallId: info.toolCallId,
                toolName: info.toolName,
                args: info.args,
                interactionToken: info.interactionToken,
              };
            }
          }
        : undefined,
    });

    // Resolve the ONE client-tool seam both delivery paths share. The correlation index is wired
    // for Claude only — Pi's relay toolCallId is already exact.
    env.clientToolRelayRef.current = buildClientToolRelay({
      responder,
      run,
      latch,
      pause,
      recordPendingInteraction,
      toolCallIndex: plan.isPi ? undefined : env.toolCallIndex,
      log: logger,
    });

    if (plan.useToolRelay) {
      turn.toolRelay = (deps.startToolRelay ?? startToolRelay)(
        plan.isDaytona
          ? (deps.sandboxRelayHost ?? sandboxRelayHost)(env.sandbox)
          : (deps.localRelayHost ?? localRelayHost)(),
        plan.relayDir,
        plan.toolSpecs,
        request.toolCallback as ToolCallbackContext | undefined,
        relayPermissions,
        request.runContext,
        env.clientToolRelayRef.current,
      );
    }

    // The prompt promise this turn races against the pause signal. A normal/continuation turn
    // sends a fresh prompt; a live approval resume answers the parked gate on the SAME session and
    // continues the ORIGINAL, still-pending prompt promise (the tool then runs with its original
    // byte-exact args). Either way, on a HITL pause the prompt resolves cancelled or never
    // resolves, and the pause signal ends the turn.
    let promptPromise: Promise<unknown>;
    if (opts.resume) {
      // The new (resume) turn owns streaming + tracing; the environment is already wired to route
      // continued events into this turn's sink (env.currentTurn was set above). Seed this run's
      // trace with the parked tool call so the completing `tool_call_update` closes it and the FE
      // approval part flips to output-available even if the adapter re-announces nothing. Then
      // answer the gate on the live session — the original prompt continues from here.
      run.handleUpdate({
        sessionUpdate: "tool_call",
        toolCallId: opts.resume.toolCallId,
        title: opts.resume.toolName,
        kind: opts.resume.toolName,
        rawInput: opts.resume.args,
      });
      promptPromise = Promise.resolve(opts.resume.promptPromise);
      promptPromise.catch(() => {});
      await env.session.respondPermission(
        opts.resume.permissionId,
        opts.resume.reply,
      );
      // The gate is answered: resolve the durable interaction row (the parked pending row the cold
      // path would otherwise resolve via its decision map). The fresh per-turn pause controller
      // starts with an EMPTY pausedToolCallIds set, so the resumed call's `tool_call_update` frames
      // are no longer suppressed and stream through — the "clear pausedToolCallIds on resume" step.
      resolveInteractionToken(opts.resume.interactionToken);
      logger(
        `[keepalive] resume answered gate reply=${opts.resume.reply} tool=${opts.resume.toolName ?? "?"}`,
      );
    } else {
      promptPromise = Promise.resolve(
        env.session.prompt([{ type: "text", text: turnText }]),
      );
      promptPromise.catch(() => {});
    }
    const raced = await Promise.race([
      promptPromise,
      pause.signal.then(() => PAUSED),
      runLimitTripped.then(() => RUN_LIMIT_TRIPPED),
    ]);
    // A tripped run-limit ends the turn as an error: throw into the shared catch below so the
    // trace is flushed and the caller's teardown reclaims the (wedged) sandbox.
    if (raced === RUN_LIMIT_TRIPPED) {
      throw new Error(runLimitReason ?? "run limit tripped");
    }
    const stopReason =
      raced === PAUSED || pause.active ? "paused" : (raced as any)?.stopReason;
    const result = raced === PAUSED ? undefined : raced;
    // A parkable pause this turn: hand the still-pending prompt promise to the parked record so a
    // later resume can await the same continuation. (Set after the race so `promptPromise` exists.
    // The read is asserted because the onUserApprovalGate callback set the field via an async
    // mutation TS's flow analysis cannot see, so it would otherwise narrow the reset to `never`.)
    const parkedThisTurn = env.parkedApproval as ParkedApproval | undefined;
    if (opts.approvalParkMode && pause.active && parkedThisTurn) {
      parkedThisTurn.promptPromise = promptPromise;
    }
    await turn.toolRelay?.stop();
    logger(`prompt stopReason=${stopReason}`);

    const usage = await resolveRunUsage({
      sandbox: env.sandbox,
      usageOutPath: plan.usageOutPath,
      isDaytona: plan.isDaytona,
      promptResult: result,
      streamUsage: run.usage(),
    });
    run.setUsage(usage);

    const swallowedPiError =
      plan.isPi &&
      !plan.isDaytona &&
      !run.output().trim() &&
      !run.events().some((e) => e.type === "tool_call")
        ? findSwallowedPiError(
            env.runAgentDir ?? plan.sourcePiAgentDir,
            plan.cwd,
          )
        : undefined;
    let swallowedError: string | undefined;
    if (swallowedPiError) {
      swallowedError = conciseError(
        new Error(swallowedPiError),
        plan.harness,
        request.provider,
      );
      run.recordError(swallowedError, request.provider);
      run.emitEvent({ type: "error", message: swallowedError });
    }

    const output = run.finish();
    await run.flush();

    if (swallowedError) {
      return { ok: false, error: swallowedError };
    }

    return {
      ok: true,
      output,
      messages: output ? [{ role: "assistant", content: output }] : [],
      events: emit ? [] : run.events(),
      usage,
      stopReason,
      capabilities: {
        ...env.capabilities,
        streamingDeltas: !!emit && env.capabilities.streamingDeltas,
      },
      sessionId,
      model: env.model ?? request.model,
      traceId: run.traceId(),
    } as AgentRunResult;
  } catch (err) {
    const error = conciseError(err, plan.harness, request.provider);
    otel?.recordError(error, request.provider);
    otel?.emitEvent({ type: "error", message: error });
    // finish() must not throw uncaught — tracing must not mask the run error.
    try {
      otel?.finish();
    } catch {}
    await otel?.flush().catch(() => {});
    return { ok: false, error };
  } finally {
    // Release every run-limits timer (idempotent, never re-arms on a late event) on EVERY path.
    runLimits.dispose();
    // This turn owns its relay: stop it on EVERY exit path (the happy path already stopped it
    // after the prompt; stop is safe to repeat, matching the old finally). Null it afterwards so
    // a later `destroy()` — possibly after the dispatch cleared the sink — cannot double-stop or
    // orphan it.
    await activeTurn?.toolRelay?.stop().catch(() => {});
    if (activeTurn) activeTurn.toolRelay = undefined;
  }
}

/**
 * The cold, one-turn-per-environment entry (also the flag-off path). Acquire an environment, run
 * one turn, then tear the environment down — exactly as the single `try/finally` did before the
 * split, so behavior here is byte-identical to pre-keep-alive.
 */
export async function runSandboxAgent(
  request: AgentRunRequest,
  emit?: EmitEvent,
  signal?: AbortSignal,
  deps: SandboxAgentDeps = {},
): Promise<AgentRunResult> {
  const acquired = await acquireEnvironment(request, deps, signal);
  if (!acquired.ok) return { ok: false, error: acquired.error };
  const env = acquired.env;
  try {
    return await runTurn(env, request, emit, signal);
  } finally {
    await env.destroy();
  }
}
