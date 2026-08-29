import { InMemorySessionPersistDriver, SandboxAgent } from "sandbox-agent";
import type { SeededDecision } from "../../sessions/interactions.ts";

import {
  type AgentRunRequest,
  type HarnessCapabilities,
} from "../../protocol.ts";
import { type Responder } from "../../responder.ts";
import type { ClientToolRelay } from "../../tools/client-tool-relay.ts";
import type { ExecutableToolGate } from "../../tools/executable-tool-gate.ts";
import {
  localRelayHost,
  sandboxRelayHost,
  startToolRelay,
} from "../../tools/relay.ts";
import { createSandboxAgentOtel } from "../../tracing/otel.ts";
import type { PiTraceTurnExport } from "../../tracing/pi-trace-turn-export.ts";
import { createAcpFetch } from "./acp-fetch.ts";
import { type ParkedApprovalGateType } from "./acp-interactions.ts";
import { signAgentMountCredentials } from "./agent-mount.ts";
import { probeCapabilities } from "./capabilities.ts";
import { createToolCallCorrelationIndex } from "./client-tools.ts";
import { buildDaemonEnv, resolveDaemonBinary } from "./daemon.ts";
import { createCookieFetch, prepareDaytonaPiAssets } from "./daytona.ts";
import { applyCodexMode } from "./codex-mode.ts";
import { applyModel } from "./model.ts";
import {
  discoverTunnelEndpoint,
  mountHarnessSessionDirs,
  mountStorage,
  mountStorageRemote,
  signSessionMountCredentials,
  unmountStorage,
  type MountCredentials,
} from "./mount.ts";
import { PendingApprovalPauseController } from "./pause.ts";
import { buildSandboxProvider } from "./provider.ts";
import { createRunLimits, resolveRunLimits } from "./run-limits.ts";
import { type BuildRunPlanDeps, type RunPlan } from "./run-plan.ts";
import { readStoredSandboxPointer } from "./sandbox-reconnect.ts";
import {
  appendSessionTurn,
  hydrateHarnessSessionFromDurable,
} from "./session-continuity-durable.ts";
import { type SessionContinuityStore } from "./session-continuity.ts";
import { type InstalledMountExpiries } from "./session-identity.ts";
import type { AppliedEnvironmentState } from "./applied-state.ts";
import type { FacetDigests } from "../../lifecycle/desired-state.ts";
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
  applyCodexMode?: typeof applyCodexMode;
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
 * Recorded for Claude and Codex ACP permission gates, or a Pi ACP permission gate (Pi approval
 * parking: the gate rides the extension's `ctx.ui.confirm` onto the same ACP permission plane).
 * NOT recorded for a client-tool MCP pause, which cannot be answered across a turn boundary and
 * stays on the cold path. Existence of this record is what makes the dispatch park a paused
 * session in `awaiting_approval` instead of tearing it down.
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

/** Answer a parked ACP permission gate on the live session (the keep-alive resume input). */
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
  /** Latest session credential accessor; long turns may refresh the value between API calls. */
  credential?: () => string;
  /**
   * Durable approval decisions this session already holds, read and CLAIMED by the caller via
   * `loadDurableDecisions`. Passed in rather than read here because that read is I/O and
   * `runTurn` must not suspend before its permission responder is attached.
   */
  seededDecisions?: readonly SeededDecision[];
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
   * Keep-alive approval park mode: on a parkable ACP permission gate the pause keeps the session
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
  /**
   * What this environment ACTUALLY has installed.
   *
   * LIFECYCLE MIGRATION, STEP 2. The pool reads this instead of a fingerprint its caller supplies,
   * so a request can no longer stamp a configuration the environment never applied. Only
   * `commitApplied` advances it, and only after a lifecycle action succeeds. See
   * `applied-state.ts`.
   */
  readonly appliedState: AppliedEnvironmentState;
  /**
   * What the workspace write left behind, so a later in-place refresh knows what to DELETE.
   *
   * Undefined until a workspace is materialized. A refresh with no inventory refuses rather than
   * writing without deleting: a stale skill left readable is the failure that route exists to
   * prevent. See `environment/workspace-manager.ts`.
   */
  workspaceInventory?: import("../../environment/workspace-manager.ts").WorkspaceInventory;
  /**
   * Close and reopen this environment's harness session on the SAME sandbox.
   *
   * A CLOSURE built at acquire, exactly like `destroy`, because a reopen needs the persist
   * driver, the session-init payload and the local session key — all of which live in the acquire
   * scope and none of which belong on this interface individually.
   *
   * Undefined when the environment never opened a session. The caller then rebuilds.
   */
  reopenSession?: (opts: {
    transcriptReplayable: boolean;
  }) => Promise<
    import("../../environment/harness-session-lifecycle.ts").ReopenResult
  >;
  /**
   * How a rotated credential reaches this environment WITHOUT rebuilding it, or undefined.
   *
   * LIFECYCLE MIGRATION, STEP 8. This is the single source of truth for what a rotation costs on
   * this environment, and it is a property of the ENVIRONMENT rather than of the provider name on
   * the request. The difference is load-bearing: a Daytona run with credential hiding switched off
   * puts the values in the daemon environment as plain variables, so it holds no reference to
   * rotate and must rebuild — a table keyed by "daytona" would claim a live rotation it cannot
   * perform. Undefined means "no live credential route here", which is always a sound answer.
   */
  credentialDelivery?: import("../../providers/credential-delivery-port.ts").CredentialDeliveryPort;
  /** Record a lifecycle action that already succeeded. The only writer of `appliedState`. */
  commitApplied: (result: {
    configFingerprint: string;
    facets: FacetDigests;
    fieldDigests: Record<string, string>;
  }) => void;
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
  /** The current turn's executable-tool gate, read by the loopback MCP server. */
  executableToolGateRef: { current?: ExecutableToolGate };
  mcpAbort: AbortController;
  runAgentDir: string | undefined;
  /**
   * The local off-mount directory this run pointed CODEX_SQLITE_HOME at (Codex's SQLite state,
   * which cannot live on the geesefs cwd mount). Removed best-effort by `destroy`; the state is
   * disposable because native resume rides the `sessions/` rollout files on CODEX_HOME, not the
   * SQLite. Undefined when not a local managed Codex run.
   */
  codexSqliteHome: string | undefined;
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
  /**
   * Expiry (epoch millis) of the credentials actually installed in each running geesefs daemon,
   * recorded at successful mount time. Per mount, because a remount replaces one mount's
   * credentials and must not inherit the other's. The environment's lease is the minimum over the
   * entries; see `installedMountLease`.
   *
   * The Daytona harness session-dir mounts are deliberately excluded: they are signed after the
   * cwd mount with the same TTL, so their expiry is never the minimum.
   */
  installedMountExpiries: InstalledMountExpiries;
  durableCwdSafeToDelete: boolean;
  workspace: { cleanup: () => Promise<void> } | undefined;
  runtimeRemount: Promise<boolean> | undefined;
  closeToolMcp: (() => Promise<void>) | undefined;
  currentTurn?: CurrentTurn;
  /** Pi's native span spool for the original prompt; survives approval park/resume. */
  piTraceExport?: PiTraceTurnExport;
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
   * Frozen approval bytes and single-use authorization records for commits that reference
   * workspace files (`@ag.file`). Session-scoped so a parked approval survives to its live
   * resume and commits the exact bytes the human saw; the turn drops it whenever it did not
   * park, and a cold resume gets a new environment and therefore an empty store, which is what
   * forces a fresh gate rather than executing bytes nobody approved.
   */
  commitAuthorization?: import("./approved-content.ts").CommitAuthorizationState;
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
