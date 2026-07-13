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
  type RelayExecutionGuard,
} from "../tools/relay.ts";
import {
  ApprovalResponder,
  ApprovedExecutionGrants,
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
  DAYTONA_PI_DIR,
} from "./sandbox_agent/daytona.ts";
import { conciseError } from "./sandbox_agent/errors.ts";
import { buildSessionMcpServers } from "./sandbox_agent/mcp.ts";
import { applyModel } from "./sandbox_agent/model.ts";
import { findSwallowedPiError } from "./sandbox_agent/pi-error.ts";
import {
  buildPiExtensionEnv,
  prepareLocalPiAssets,
  uploadSystemPromptToSandbox,
  writeSystemPromptLocal,
  writeOtlpAuthFile,
} from "./sandbox_agent/pi-assets.ts";
import {
  uploadToolMcpAssets,
  type ToolMcpAssets,
} from "./sandbox_agent/tool-mcp-assets.ts";
import { advertisedToolSpecs } from "../tools/public-spec.ts";
import { buildRelayExecutionGuard } from "./sandbox_agent/relay-guard.ts";
import {
  PendingApprovalLatch,
  permissionsFromRequest,
} from "../permission-plan.ts";
import {
  attachPermissionResponder,
  type ParkedApprovalGateType,
} from "./sandbox_agent/acp-interactions.ts";
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
import { claimSessionOwnership, REPLICA_ID } from "../sessions/alive.ts";
import {
  teardownDisposition,
  type TeardownReason,
} from "./sandbox_agent/teardown.ts";
import { buildSandboxProvider } from "./sandbox_agent/provider.ts";
import { DaytonaReconnectTerminalError } from "./sandbox_agent/daytona-provider.ts";
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
  mountHarnessSessionDirs,
  harnessSessionMounts,
  storeReachableFromSandbox,
  type MountCredentials,
} from "./sandbox_agent/mount.ts";
import {
  AGENT_MOUNT_ENV_VAR,
  agentMountPath,
  linkAgentFiles,
  linkAgentFilesRemote,
  seedAgentReadme,
  seedAgentReadmeRemote,
  signAgentMountCredentials,
} from "./sandbox_agent/agent-mount.ts";
import {
  AGENT_MOUNT_SYSTEM_PROMPT_SEGMENT,
  claudeMountSystemPromptMeta,
  combineAppendSystemPrompt,
  type ClaudeSystemPromptMeta,
} from "./sandbox_agent/agent-mount-guidance.ts";
import {
  hydrateHarnessSessionFromDurable,
  syncHarnessSessionDurable,
} from "./sandbox_agent/session-continuity-durable.ts";
import {
  readStoredSandboxPointer,
  clearSandboxPointer,
  writeSandboxPointer,
} from "./sandbox_agent/sandbox-reconnect.ts";
import {
  assertLocalRunnerOwnership,
  eligibleAgentSessionId,
  nextTurnIndex,
  sessionContinuityStore,
  type SessionContinuityStore,
} from "./sandbox_agent/session-continuity.ts";
import { resolvesToLocalProvider } from "./sandbox_agent/session-pool.ts";

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

// In-flight sandbox handles, by run. A process KILL (docker stop / SIGTERM / OOM mid-run) skips
// the per-run teardown — so a shutdown signal handler (see `server.ts`) drains this set to
// best-effort delete any still-running sandbox before exit. Remote (Daytona) sandboxes that even a
// signal can never reach (SIGKILL/OOM) self-reap via the lifecycle reapers in `provider.ts`.
const inFlightSandboxes = new Set<{
  destroy: (opts?: { reason?: TeardownReason }) => Promise<void>;
  sessionId: string;
  mountProjectId?: string;
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
      (!projectId || environment.mountProjectId === projectId),
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

function shouldSuppressPausedToolCallUpdate(
  update: unknown,
  pause: PendingApprovalPauseController,
): boolean {
  const frame = update as
    | { sessionUpdate?: unknown; toolCallId?: unknown }
    | undefined;
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
): void {
  if (acpAgent !== "claude") return;

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
  }
}

/**
 * Whether a requested-but-unsettable model fails the run (F-007). Strict by default on every
 * harness path: a user who picks a model either runs that model or sees a loud error, never a
 * silent (often pricier) fallback to the harness default. `AGENTA_AGENT_MODEL_STRICT=false` is
 * the explicit opt-out that restores the legacy warn-and-fallback behavior. A run that requests
 * no model is unaffected either way — it keeps the harness default.
 */
function modelResolutionStrict(): boolean {
  return process.env.AGENTA_AGENT_MODEL_STRICT !== "false";
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
  prepareDaytonaPiAssets?: typeof prepareDaytonaPiAssets;
  uploadToolMcpAssets?: typeof uploadToolMcpAssets;
  probeCapabilities?: typeof probeCapabilities;
  applyModel?: typeof applyModel;
  startToolRelay?: typeof startToolRelay;
  localRelayHost?: typeof localRelayHost;
  sandboxRelayHost?: typeof sandboxRelayHost;
  signSessionMountCredentials?: typeof signSessionMountCredentials;
  signAgentMountCredentials?: typeof signAgentMountCredentials;
  mountStorage?: typeof mountStorage;
  mountStorageRemote?: typeof mountStorageRemote;
  unmountStorage?: typeof unmountStorage;
  discoverTunnelEndpoint?: typeof discoverTunnelEndpoint;
  /** Per-harness transcript mounts (remote only; see mount.ts). */
  mountHarnessSessionDirs?: typeof mountHarnessSessionDirs;
  responderFactory?: (request: AgentRunRequest) => Responder;
  resolveRunLimits?: typeof resolveRunLimits;
  createRunLimits?: typeof createRunLimits;
  /** Session-continuity store override (tests inject their own; default is the process singleton). */
  sessionContinuityStore?: SessionContinuityStore;
  /** Durable read-back/write-forward of the continuity store (tests inject fakes). */
  hydrateHarnessSessionFromDurable?: typeof hydrateHarnessSessionFromDurable;
  syncHarnessSessionDurable?: typeof syncHarnessSessionDurable;
  /** Durable read/write of the sandbox pointer, for the remote reconnect ladder. */
  readStoredSandboxPointer?: typeof readStoredSandboxPointer;
  clearSandboxPointer?: typeof clearSandboxPointer;
  writeSandboxPointer?: typeof writeSandboxPointer;
  /**
   * Resolve `{replicaId, ownerReplicaId}` for a session-owned local-sandbox run, so
   * `acquireEnvironment` can fail loudly instead of silently cold-starting on a non-owner
   * replica. The default claims the `owner` affinity key via the coordination plane and reads
   * back the actual owner (`claimSessionOwnership`); tests inject their own. `authorization` is
   * the run credential (the claim authenticates as the invoke caller).
   */
  resolveLocalRunnerOwner?: (
    sessionId: string,
    authorization: string,
  ) => Promise<{ replicaId: string; ownerReplicaId: string | undefined }>;
  log?: Log;
}

async function defaultResolveLocalRunnerOwner(
  sessionId: string,
  authorization: string,
): Promise<{ replicaId: string; ownerReplicaId: string | undefined }> {
  // No credential ⇒ the claim would 401; treat as "no known owner" (pass), never worse than today.
  if (!authorization) {
    return { replicaId: REPLICA_ID, ownerReplicaId: undefined };
  }
  return claimSessionOwnership(sessionId, authorization);
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
  toolRelay?: { ready?: Promise<void>; stop: () => Promise<void> };
  /** Route a session/update for the active turn (suppress + handleUpdate + pause re-sweep). */
  handleUpdate: (update: unknown) => void;
  /** Route a permission reverse-RPC for the active turn (built by attachPermissionResponder). */
  onPermissionRequest?: (req: unknown) => void;
}

/**
 * A permission gate that paused the turn and can be answered later on the SAME live session.
 * Recorded for a Claude ACP permission gate (keep-alive slice 2) or a Pi ACP permission gate
 * (Pi approval parking: the gate rides the extension's `ctx.ui.confirm` onto the same ACP
 * permission plane). NOT recorded for a client-tool MCP pause — that cannot be answered across
 * a turn boundary and stays on the cold path. Existence of this record is what makes the
 * dispatch park a paused session in `awaiting_approval` instead of tearing it down.
 */
export interface ParkedApproval {
  /** Which gate paused; the dispatch resumes only a recognized type and treats others as cold. */
  gateType: ParkedApprovalGateType;
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
   * The session was rehydrated via `session/load` (the patched `resumeSession`), so the harness
   * already holds the prior turns natively. Like `continuation`, the prompt is only the new user
   * text; `buildTurnText` must not run. Distinct field from `continuation` because the two arrive
   * through different acquire paths (live pool checkout vs a fresh cold acquire that loaded an
   * old session) — `runTurn` treats them identically for the text-selection decision.
   */
  loaded?: boolean;
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
 * Send only the new user text (not the full cold transcript) when the harness already holds the
 * prior turns: a live continuation, or a session rehydrated via `session/load`. `runTurn` calls
 * this, so a test that pins it pins the shipped decision.
 */
export function sendLastMessageOnly(opts: RunTurnOptions): boolean {
  return Boolean(opts.continuation || opts.loaded);
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
  agentMountCreds?: MountCredentials | null;
  /** The mount's owning project id (keep-alive pool key FALLBACK scope, preferred is
   * `runContext.project.id`); undefined when there is no mount. */
  mountProjectId?: string;
  /** This acquire resumed the harness's native session via `session/load` (not cold). */
  loadedFromContinuity: boolean;
  /** A remote, session-owned run whose sandbox can be parked (warm) rather than deleted at end. */
  resumable: boolean;
  /** The conversation turn index this acquire's continuity record was read/written at. */
  continuityTurnIndex: number | undefined;
  // Mutable teardown/turn state shared across acquire, runTurn, and destroy.
  sessionDestroyRequested: boolean;
  mountedCwd: string | undefined;
  agentMountedPath?: string;
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
   * The Claude ACP permission gate the LAST turn paused on, or undefined. Set only for a harness
   * ACP permission gate, reset at each turn start; the dispatch reads it after a paused turn to
   * decide whether to park in `awaiting_approval` and, on the next request, how to resume.
   */
  parkedApproval?: ParkedApproval;
  /**
   * How many Claude ACP permission gates resolved to pendingApproval THIS turn (reset at turn
   * start). More than one means parallel gates the single-gate resume cannot answer, so the
   * dispatch does not park (tears down cold as today).
   */
  approvalGateCount: number;
  destroyed: boolean;
  /** Complete, idempotent teardown selected from the typed teardown reason. */
  destroy: (opts?: { reason?: TeardownReason }) => Promise<void>;
  /** End the active turn: clear the current-turn sink (called before a park). */
  clearTurn: () => void;
}

export type AcquireEnvironmentResult =
  | { ok: true; env: SessionEnvironment }
  | { ok: false; error: string };

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
  const agentMountDir = agentMountCreds ? agentMountPath(plan.cwd) : undefined;

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
  let runAgentDir = prepareLocalPiAssets({ plan, env, log: logger });

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
      )(
        environment.agentMountedPath,
        { log },
      ).catch(() => false);
      if (agentMountSafeToDelete) {
        try {
          rmSync(environment.agentMountedPath, { recursive: true, force: true });
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
    // The per-run Agenta agent dir (skills isolation) is throwaway; remove it too.
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
    runAgentDir = prepareLocalPiAssets({ plan, env, log: logger });
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
      await (deps.prepareDaytonaPiAssets ?? prepareDaytonaPiAssets)({
        sandbox: environment.sandbox,
        plan,
        log: logger,
      });
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
        // byte-identical. Opt-out via env, default on wherever a durable cwd mount is active (no
        // separate credential/session-id path from the cwd mount).
        if (
          canMount &&
          sessionForMount &&
          runCred &&
          process.env.AGENTA_SESSION_HARNESS_MOUNTS !== "false"
        ) {
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
          await linkAgentFilesRemote(
            environment.sandbox,
            plan.cwd,
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
    try {
      environment.workspace = await (deps.prepareWorkspace ?? prepareWorkspace)(
        {
          sandbox: environment.sandbox,
          plan,
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
          log: logger,
        });
      } else {
        throw err;
      }
    } finally {
      timingLog("prepare_workspace", prepareWorkspaceStartedAt);
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
 * Route one harness event into the active turn's sink.
 *
 * Data flow: the ACP session emits an event -> we demux it -> the active turn
 * (`environment.currentTurn`) consumes the update. The session listener is attached ONCE and
 * outlives every turn, so this must never throw: the sandbox-agent registries are plain Sets and a
 * thrown handler would corrupt the event stream, so any error is swallowed and logged.
 *
 * Steps: let the ENOTCONN watcher observe the raw event, extract the update payload (dropping events
 * that carry none), record live tool_call ids for client-tool correlation, then hand the update to
 * the active turn — or, between turns when no turn owns it, log and drop it.
 */
function routeSessionEventToActiveTurn(
  environment: SessionEnvironment,
  remountLocalCwdAfterRuntimeEnotconn: (event: unknown) => void,
  event: any,
): void {
  const { logger, plan } = environment;
  try {
    remountLocalCwdAfterRuntimeEnotconn(event);
    const payload = event?.payload;
    const update = payload?.params?.update ?? payload?.update;
    if (!update) return;
    // Record live ACP tool_call ids so a paused client_tool can correlate to Claude's bubble
    // (session-scoped; a lookup CONSUMES its matched id).
    environment.toolCallIndex.record(update);
    const turn = environment.currentTurn;
    if (turn) {
      turn.handleUpdate(update);
    } else {
      // Between turns (parked/idle): no turn owns this event. Log and drop by decision.
      logger(`[keepalive] between-turns event dropped`);
    }
  } catch (err) {
    logger(`session onEvent handler error: ${conciseError(err, plan.harness)}`);
  }
}

/**
 * Route one permission gate into the active turn's approval handler.
 *
 * Data flow: the harness raises a permission request -> the active turn (`environment.currentTurn`)
 * decides it. Like the event listener this is attached ONCE and must never throw (a thrown handler
 * would corrupt the sandbox-agent registries), so errors are swallowed and logged.
 *
 * Between turns no turn owns the gate. An approval park is always recorded DURING the active turn
 * (the gate fires while a prompt runs, routing through currentTurn), and a parked-on-approval
 * session leaves its harness suspended on that gate, so nothing new fires while parked. A gate that
 * reaches here is therefore a genuine stray (e.g. a late teardown artifact): reject it by policy so
 * it cannot hang.
 */
function routePermissionRequestToActiveTurn(
  environment: SessionEnvironment,
  req: any,
): void {
  const { logger, plan } = environment;
  try {
    const turn = environment.currentTurn;
    if (turn?.onPermissionRequest) {
      turn.onPermissionRequest(req);
      return;
    }
    logger(
      `[keepalive] between-turns permission request, cancelling by policy id=${req?.id}`,
    );
    void Promise.resolve(
      environment.session?.respondPermission?.(req?.id, "reject"),
    ).catch(() => {});
  } catch (err) {
    logger(
      `session onPermissionRequest handler error: ${conciseError(err, plan.harness)}`,
    );
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
    // Cold: replay the full transcript (plan.turnText). Continuation or loaded: send only new text.
    const turnText = sendLastMessageOnly(opts) ? promptText : plan.turnText;

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
      // The sibling settle runs UNCONDITIONALLY, park mode or not: latch-loser tool calls
      // announced before the winning gate can never execute this turn, and skipping the settle
      // here would leave them as orphaned open parts whenever the dispatch later refuses the park
      // (multi-gate, pool full) — `env.destroy()` does not re-run it. The exclusion keeps the
      // gated (paused) call itself open, so the live resume is untouched.
      run.settleOpenToolCalls(
        (id) => pause.isPausedToolCall(id),
        TOOL_NOT_EXECUTED_PAUSED,
      );
      // Park mode: a parkable permission gate (Claude ACP or Pi ACP) recorded
      // `env.parkedApproval` BEFORE firing this pause (the onUserApprovalGate hook runs before
      // the single-pause latch). Keep the live session — the gated tool runs on the resume — so
      // skip ONLY the mcpAbort and the destroySession. The teardown is not lost: the dispatch
      // either parks the session or, if it decides not to (multi-gate, pool full), calls
      // `env.destroy()` which runs them. A non-parkable pause (keep-alive off, client tool)
      // never records `parkedApproval`, so it still tears down here exactly as today.
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
    const executionGrants = new ApprovedExecutionGrants();
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
      // Pi runs only: presence of the specs map turns Pi gate envelope detection on AND is how
      // the runner recovers specPermission/readOnlyHint (the envelope carries identity, never
      // policy). Absent for Claude, so a title collision there keeps the base path.
      piToolSpecsByName: plan.isPi
        ? new Map(
            plan.toolSpecs.map((spec) => [
              spec.name,
              {
                permission: spec.permission,
                readOnly: spec.readOnly,
                // callRef tools only: bound paths are runner-filled at execution, so the
                // approval card and decision keys must not carry the model's values for them.
                contextBindings: spec.callRef
                  ? spec.contextBindings
                  : undefined,
              },
            ]),
          )
        : undefined,
      // A resolved custom-tool allow becomes an execution grant the relay guard consumes, so
      // only a dialog-approved (or policy-allowed) call ever executes from the relay dir.
      onPiGateAllowed: (info) =>
        executionGrants.grant(info.toolName, info.args),
      // Record the parkable permission gate (only in keep-alive park mode) so the dispatch can
      // resume it live. Fires per pending gate (before the latch) so a parallel gate is counted;
      // the single-gate resume records only the FIRST gate's answer target. `info.gateType` names
      // the plane (Claude ACP vs Pi ACP) so the resume answers on the right one.
      onUserApprovalGate: opts.approvalParkMode
        ? (info) => {
            env.approvalGateCount += 1;
            if (
              env.approvalGateCount === 1 &&
              info.permissionId &&
              info.toolCallId
            ) {
              env.parkedApproval = {
                gateType: info.gateType,
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

    // EVERY harness gets the guard: the relay dir is sandbox-writable, so a forged
    // `<id>.req.json` proves nothing about any dialog having run, and this runner-side
    // re-check is the only enforcement of the hard deny boundary against forged files.
    // `allow` passes and `deny` refuses identically everywhere; `ask` splits by harness —
    // Pi consumes a dialog-recorded execution grant (fail-closed parity with the in-sandbox
    // confirm), while a non-Pi MCP harness (Claude) passes `ask` because its own harness
    // enforces the ask dialog (the rendered `mcp__agenta-tools__<tool>` ask rules + the ACP
    // permission flow) before a call reaches the shim. See buildRelayExecutionGuard for the
    // stated residual (a forged file can still trigger an ask-tool without a dialog there).
    const relayGuard: RelayExecutionGuard = buildRelayExecutionGuard({
      isPi: plan.isPi,
      permissionPlan,
      executionGrants,
    });

    if (plan.useToolRelay) {
      turn.toolRelay = (deps.startToolRelay ?? startToolRelay)(
        plan.isDaytona
          ? (deps.sandboxRelayHost ?? sandboxRelayHost)(env.sandbox, {
              log: logger,
            })
          : (deps.localRelayHost ?? localRelayHost)(),
        plan.relayDir,
        plan.toolSpecs,
        request.toolCallback as ToolCallbackContext | undefined,
        request.runContext,
        env.clientToolRelayRef.current,
        relayGuard,
        { log: logger },
      );
      // Ordering invariant: the relay's stale-file sweep must complete before the
      // resume's respondPermission or the fresh prompt below can cause a legitimate
      // request, so nothing legitimate can predate the sweep and be swallowed as
      // stale. Optional-chained so a fake relay without `ready` is tolerated, and a
      // sweep failure never kills the turn.
      await turn.toolRelay?.ready?.catch?.(() => {});
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
      // A parked Pi dialog gate resumes on a FRESH turn whose relay and grant ledger are new;
      // grant the approved call here so the extension's execute record (written right after the
      // confirm resolves) passes the relay guard. Claude resumes grant too — harmlessly, no
      // guard consults it.
      if (opts.resume.reply === "once") {
        executionGrants.grant(opts.resume.toolName, opts.resume.args);
      }
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
    // Pause notification is immediate, but terminalization must wait for managed cancellation
    // and already-queued ACP updates. Re-sweep after the drain so a sibling announced during
    // cancellation receives exactly one deterministic terminal result before `done`.
    if (stopReason === "paused") {
      await pause.waitForEventDrain();
      run.settleOpenToolCalls(
        (id) => pause.isPausedToolCall(id),
        TOOL_NOT_EXECUTED_PAUSED,
      );
    }
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
      // A failed turn may have left a partial turn in the native transcript: the prior record
      // is no longer a faithful resume point.
      invalidateContinuity(sessionId, plan.harness, deps);
      return { ok: false, error: swallowedError };
    }

    // Capture this harness's native session id for the next turn's setup. Only on a turn that
    // actually completed (not paused mid-turn — a park has not finished authoring the turn, so
    // it must not be marked authoritative) and only when the harness surfaced one.
    if (
      stopReason !== "paused" &&
      env.continuityTurnIndex !== undefined &&
      sessionId &&
      env.session?.agentSessionId
    ) {
      (deps.sessionContinuityStore ?? sessionContinuityStore).record(
        sessionId,
        plan.harness,
        env.session.agentSessionId,
        env.continuityTurnIndex,
      );
      // Mirror the record durably so it survives a runner restart; fire-and-forget.
      const syncCred = runCredential(request);
      if (syncCred) {
        void (deps.syncHarnessSessionDurable ?? syncHarnessSessionDurable)(
          sessionId,
          plan.harness,
          env.session.agentSessionId,
          env.continuityTurnIndex,
          { authorization: syncCred, log: logger },
        );
      }
    } else if (stopReason === "paused") {
      // A pause stopped mid-turn, after the harness may have written a partial turn natively.
      invalidateContinuity(sessionId, plan.harness, deps);
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
    // An aborted turn may have left a partial turn in the native transcript.
    invalidateContinuity(sessionId, plan.harness, deps);
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
/**
 * Drop the harness's continuity record after a turn that did not complete. The harness may have
 * written a partial turn into its native transcript, so a later `session/load` would resume a
 * history the canonical request never sent. Dropping it falls back to cold replay.
 */
function invalidateContinuity(
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

/**
 * Whether a completed turn's environment may be parked: never on abort, client disconnect,
 * pause, or failure. Session-owned streams survive disconnect WITHOUT aborting the run signal
 * (server policy), so the disconnect check needs the separate `clientGone` flag. A wedged
 * sandbox that failed its turn must be destroyed, not reconnected on the next one.
 */
export function shouldPark(
  result: AgentRunResult,
  signal: AbortSignal | undefined,
  clientGone: (() => boolean) | undefined,
): boolean {
  if (signal?.aborted) return false; // aborted run: destroy, do not park
  if (clientGone?.()) return false; // client disconnected mid-turn: destroy, do not park
  if (!result.ok) return false; // failed turn: teardown as today
  if (result.stopReason === "paused") return false; // a plain pause never parks
  return true;
}

export async function runSandboxAgent(
  request: AgentRunRequest,
  emit?: EmitEvent,
  signal?: AbortSignal,
  deps: SandboxAgentDeps = {},
): Promise<AgentRunResult> {
  const acquired = await acquireEnvironment(request, deps, signal);
  if (!acquired.ok) return { ok: false, error: acquired.error };
  const env = acquired.env;
  let result: AgentRunResult | undefined;
  try {
    result = await runTurn(env, request, emit, signal, {
      loaded: env.loadedFromContinuity,
    });
    return result;
  } finally {
    // `result` is undefined when runTurn threw: a failed turn, so destroy.
    const cleanResumable =
      env.resumable &&
      result !== undefined &&
      shouldPark(result, signal, undefined);
    await env.destroy({
      reason: cleanResumable
        ? "clean-resumable"
        : signal?.aborted
          ? "aborted"
          : "failed-turn",
    });
  }
}
