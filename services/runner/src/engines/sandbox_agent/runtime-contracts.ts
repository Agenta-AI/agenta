import { InMemorySessionPersistDriver, SandboxAgent } from "sandbox-agent";

import { type AgentRunRequest, type HarnessCapabilities } from "../../protocol.ts";
import { type Responder } from "../../responder.ts";
import type { ClientToolRelay } from "../../tools/client-tool-relay.ts";
import { localRelayHost, sandboxRelayHost, startToolRelay } from "../../tools/relay.ts";
import { createSandboxAgentOtel } from "../../tracing/otel.ts";
import { createAcpFetch } from "./acp-fetch.ts";
import { type ParkedApprovalGateType } from "./acp-interactions.ts";
import { signAgentMountCredentials } from "./agent-mount.ts";
import { probeCapabilities } from "./capabilities.ts";
import { createToolCallCorrelationIndex } from "./client-tools.ts";
import { buildDaemonEnv, resolveDaemonBinary } from "./daemon.ts";
import { createCookieFetch, prepareDaytonaPiAssets } from "./daytona.ts";
import { applyModel } from "./model.ts";
import { discoverTunnelEndpoint, mountHarnessSessionDirs, mountStorage, mountStorageRemote, signSessionMountCredentials, unmountStorage, type MountCredentials } from "./mount.ts";
import { PendingApprovalPauseController } from "./pause.ts";
import { buildSandboxProvider } from "./provider.ts";
import { createRunLimits, resolveRunLimits } from "./run-limits.ts";
import { type BuildRunPlanDeps, type RunPlan } from "./run-plan.ts";
import { readStoredSandboxPointer } from "./sandbox-reconnect.ts";
import { appendSessionTurn, hydrateHarnessSessionFromDurable } from "./session-continuity-durable.ts";
import { type SessionContinuityStore } from "./session-continuity.ts";
import { type TeardownReason } from "./teardown.ts";
import { uploadToolMcpAssets } from "./tool-mcp-assets.ts";
import { prepareWorkspace } from "./workspace.ts";

type Log = (message: string) => void;

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
  /** Durable read-back/append-forward of the continuity store (tests inject fakes). */
  hydrateHarnessSessionFromDurable?: typeof hydrateHarnessSessionFromDurable;
  appendSessionTurn?: typeof appendSessionTurn;
  /** Durable read of the sandbox pointer (the latest turn's sandbox_id), for the remote
   * reconnect ladder. The write side is folded into `appendSessionTurn`. */
  readStoredSandboxPointer?: typeof readStoredSandboxPointer;
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

/**
 * Race sentinel: a run-limits deadline (total/idle/TTFB/per-tool-call) tripped mid-turn. Distinct
 * from `PAUSED` so the prompt race can tell a human pause (keep the session) from a wedge deadline
 * (end the turn as an error, letting the caller's teardown reclaim the sandbox).
 */
export const RUN_LIMIT_TRIPPED = Symbol("run-limit-tripped");

/**
 * The per-turn sink the session-lifetime listeners demux into. `runTurn` swaps a fresh one in
 * at turn start (`env.currentTurn`) and the dispatch clears it at turn end. The `sandbox-agent`
 * listener registries are plain Sets — an event with no listener is dropped and a permission
 * request with no listener is CANCELLED — so the listeners stay attached for the session's whole
 * life and route into whichever turn is active, with no detach/attach window between turns.
 */
export interface CurrentTurn {
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

/**
 * An approved Pi call whose batched execution is still blocked by a sibling approval. The next
 * resume seeds this context into its tracer and execution-grant ledger before Pi can emit the
 * batch's real terminal frame.
 */
export interface ParkedApprovedExecution {
  toolCallId: string;
  toolName: string | undefined;
  args: unknown;
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
  /**
   * A live approval resume: answer the matching parked gates and carry the untouched gates into
   * the next park. All decisions share the one held prompt promise (there is one prompt per turn).
   */
  resume?: {
    decisions: ResumeApprovalInput[];
    carriedForward: ParkedApproval[];
  };
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
  /** This run's resolved project scope (`projectScopeFor`: run-context preferred, mount
   * fallback) — the same scope `poolKeyFor` keys on. Undefined when neither source yields
   * one; a scoped `/kill` can then never claim this sandbox (see `destroyInFlightSandboxesForSession`). */
  projectScopeId?: string;
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
   * Every parkable ACP permission gate the LAST turn paused on, keyed by the gated tool-call id
   * (reset at each turn start). This is the source of truth the warm resume iterates: a turn can
   * hold more than one gate (parallel gated tool calls), and each is answered by its own
   * `permissionId` on the live session. Empty when no parkable gate paused the turn.
   */
  parkedApprovals: Map<string, ParkedApproval>;
  /**
   * The FIRST parked gate this turn, a convenience for per-turn-uniform reads (logging, the
   * gate-type check, the shared history/credential validation). Undefined when the map is empty.
   * The multi-answer resume and the all-parkable park check read `parkedApprovals`, not this.
   */
  parkedApproval?: ParkedApproval;
  /**
   * Approved Pi calls settled with the non-retry unknown-result sentinel while a sibling gate was
   * parked. Consumed and re-seeded on the next live resume; empty outside that internal carry.
   */
  parkedApprovedExecutions?: Map<string, ParkedApprovedExecution>;
  /**
   * How many ACP permission gates resolved to pendingApproval THIS turn (reset at turn start).
   * Equals `parkedApprovals.size` when every gate carried a resumable tool-call id; a larger
   * count means a gate lacked an id and cannot be resumed live, so the dispatch stays cold.
   */
  approvalGateCount: number;
  /**
   * How many NON-parkable pauses happened this turn (a client-tool ACP gate or a browser-fulfilled
   * relay/MCP client tool), reset at turn start. Non-zero means the turn mixes an unanswerable
   * client-tool pause into the set, so the whole turn stays on the cold path (only cold can
   * multiplex a mixed set today).
   */
  nonParkablePauseCount: number;
  destroyed: boolean;
  /** Complete, idempotent teardown selected from the typed teardown reason. */
  destroy: (opts?: { reason?: TeardownReason }) => Promise<void>;
  /** End the active turn: clear the current-turn sink (called before a park). */
  clearTurn: () => void;
}

export type AcquireEnvironmentResult =
  | { ok: true; env: SessionEnvironment }
  | { ok: false; error: string };
