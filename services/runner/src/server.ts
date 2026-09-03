/**
 * Agent runner HTTP server: the HTTP transport for the Harness port.
 *
 * Same contract as the CLI, exposed over HTTP so the wrapper can run as its own
 * container (a sidecar) that the Python service calls in-network:
 *
 *   GET  /health              -> runner identity ({ status, runner, protocol, engines, harnesses })
 *   GET  /subscription-status -> one login state per harness (no paths, no credentials)
 *   POST /stream              -> body is an AgentRunRequest, NDJSON event stream (alias: POST /run)
 *   POST /kill                -> best-effort, idempotent teardown, scoped to one { sessionId, projectId }
 *   POST /cancel              -> stop the CURRENT TURN of one session and keep it warm
 *
 * Uses Node's built-in http server (no framework dependency).
 *
 * `createAgentServer(run)` is the testable seam: it builds the server around an injectable
 * engine runner so the HTTP behavior can be tested with a fake engine (no live harness).
 */
import { apiBase, runWithRequestApiBase } from "./apiBase.ts";
import { loadDurableDecisions } from "./sessions/interactions.ts";
import {
  isUserStopAbort,
  USER_STOP_ABORT_REASON,
} from "./sessions/stop-signal.ts";
import { randomUUID, timingSafeEqual } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";

import type {
  AgentRunRequest,
  AgentRunResult,
  EmitEvent,
  StreamRecord,
} from "./protocol.ts";
import { currentUserTurn } from "./protocol.ts";
import {
  attachmentCountError,
  claimAttachments,
} from "./sessions/attachments.ts";
import {
  acquireEnvironment,
  destroyInFlightSandboxes,
  destroyInFlightSandboxesForSession,
  resolveKeepaliveMount,
  runSandboxAgent,
  runTurn,
  shouldPark,
  type ParkedApproval,
  type SessionEnvironment,
} from "./engines/sandbox_agent.ts";
import {
  isMounted,
  type MountCredentials,
} from "./engines/sandbox_agent/mount.ts";
import type { TeardownReason } from "./engines/sandbox_agent/teardown.ts";
import {
  approvalDecisionForToolCall,
  poolKeyFor,
  projectScopeFor,
  readKeepaliveConfig,
  tailIsFreshUserMessage,
  type KeepaliveConfig,
  type KeepaliveProviderName,
} from "./engines/sandbox_agent/session-identity.ts";
import {
  platformCredentialForRequest,
  runCredential,
} from "./engines/sandbox_agent/runtime-policy.ts";
import { endpointHost } from "./tracing/export-diagnostics.ts";
import { publicApiBaseConfigured } from "./tracing/otel.ts";
import { SessionPool } from "./engines/sandbox_agent/session-pool.ts";
import { runnerInfo } from "./version.ts";
import { subscriptionStatusResponse } from "./subscription-status.ts";
import {
  assertRunnerToken,
  loadRunnerConfig,
  runnerConfigSummary,
} from "./config/runner-config.ts";
import { applyDaytonaSdkEnv } from "./engines/sandbox_agent/daytona-provider.ts";
import { isEntrypoint } from "./entry.ts";
import { insecureEgressAllowed } from "./tools/ssrf-guard.ts";
import {
  SESSION_TURN_IN_USE_CODE,
  SESSION_TURN_IN_USE_MESSAGE,
} from "./sessions/admission.ts";
import {
  REPLICA_ID,
  releaseOwnedSessions,
  startAliveWatchdog,
} from "./sessions/alive.ts";
import {
  applyCommand,
  holdsSession,
  type ControlCommand,
  type ParkedSessionControl,
} from "./sessions/control-channel.ts";
import {
  noteExecutionProject,
  registerExecution,
  unregisterExecution,
} from "./sessions/execution-registry.ts";
import {
  awaitTurnOrAbandon,
  resolveTurnSettleLimits,
} from "./sessions/turn-settle.ts";
import {
  ABANDONED_TURN_MARKER,
  type RunErrorCode,
} from "./engines/sandbox_agent/errors.ts";
import {
  buildWorkflowReferenceList,
  cancelStaleInteractions,
} from "./sessions/interactions.ts";
import { proposeSessionName } from "./sessions/name.ts";
import {
  buildPersistingEmitter,
  noteRecordsIncomplete,
  takePersistFailures,
} from "./sessions/persist.ts";
import { seedForRun } from "./redaction.ts";

// Server binding (host/port) comes from the typed `RunnerConfig` resolved at boot. The host
// binds to loopback by default (sidecar-trust step 1): the `/run` body carries plaintext provider
// secrets and reusable bearer tokens, so the sidecar MUST sit on a trusted, non-public network.
// In Kubernetes/Compose, set `AGENTA_RUNNER_HOST` to the private pod/internal-network interface;
// never publish the port to the host.

// Required shared `/run` token (sidecar-trust step 2). Every request must present the same secret
// (in `Authorization: Bearer <token>` or `X-Agenta-Runner-Token: <token>`) or it is rejected with
// 401. There is no unauthenticated mode: `assertRunnerToken` refuses to boot the HTTP surface
// without the token, so by the time a request reaches here the secret always exists. Defense-in-depth
// ON TOP OF network isolation, not a replacement; a static shared secret is not a substitute for TLS
// (deferred).
const RUNNER_TOKEN_ENV = "AGENTA_RUNNER_TOKEN";

// Per-box in-flight counter: gates `/stream` and the `/run` back-compat alias at the process,
// independent of the per-project DB count, so one hot replica can't saturate. Value from config.
const CONCURRENCY_LIMIT_ENV = "AGENTA_RUNNER_CONCURRENCY_LIMIT";
const DEFAULT_CONCURRENCY_LIMIT = 1000;

function concurrencyLimit(): number {
  const raw = process.env[CONCURRENCY_LIMIT_ENV];
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_CONCURRENCY_LIMIT;
}

let inFlight = 0;

/** Constant-time string compare so the token check does not leak length/prefix via timing. */
function tokensMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** The bearer/token a caller presented, from either accepted header. Empty string if none. */
function presentedToken(req: IncomingMessage): string {
  const header = req.headers["x-agenta-runner-token"];
  if (typeof header === "string" && header) return header;
  const auth = req.headers["authorization"];
  // Linear scan, not a regex: `/^Bearer\s+(.+)$/` is polynomial-ReDoS (js/polynomial-redos) —
  // `\s+` and `.+` both match spaces, so a long all-space header backtracks in O(n^2) and stalls
  // the single-threaded runner. The fixed `^Bearer\s` prefix has no ambiguous quantifier (O(n));
  // `slice(6).trim()` then yields the same token `\s+(.+)` did.
  if (typeof auth === "string" && /^Bearer\s/i.test(auth)) {
    const token = auth.slice(6).trim();
    if (token) return token;
  }
  return "";
}

/** Whether this `/run` request is authorized; the presented token must match `AGENTA_RUNNER_TOKEN` exactly. */
function isAuthorized(req: IncomingMessage): boolean {
  const expected = process.env[RUNNER_TOKEN_ENV];
  // Fail closed. `loadRunnerConfig` already refused to boot without a token, so a missing value
  // here means the environment was mutated out from under a running process — deny, never accept.
  if (!expected) return false;
  return tokensMatch(presentedToken(req), expected);
}

/**
 * Per-run flags the HTTP edge passes alongside the request. `clientGone` reports whether the
 * streaming client has disconnected: session-owned runs survive disconnect (the run `signal` is
 * deliberately NOT aborted), so the keep-alive park decision needs this separate channel to obey
 * "disconnect means destroy, never park".
 */
export interface RunAgentOptions {
  clientGone?: () => boolean;
  /** Latest session credential; the alive watchdog refreshes it during long turns. */
  credential?: () => string;
}

/** Run one request through an engine. Tests inject a fake to avoid a live harness. */
export type RunAgent = (
  request: AgentRunRequest,
  emit?: EmitEvent,
  signal?: AbortSignal,
  options?: RunAgentOptions,
) => Promise<AgentRunResult>;

/**
 * Whether this request is session-owned (a run the runner coordinates + persists).
 * A `sessionId` is sufficient — it names the conversation. The `turnId` is the runner's
 * to mint per execution (the client never composes one), so it is NOT part of the gate.
 */
function isSessionOwned(request: AgentRunRequest): boolean {
  return !!request.sessionId?.trim();
}

/**
 * The turn correlator: identifies the currently-running stream. The runner owns running,
 * so it mints the turn when it starts a session-owned run (the coordination plane mints its
 * own in `_start_turn` for send/steer). A turn_id is a lock value, not a pk — uuid4 is fine.
 */
function resolveTurnId(request: AgentRunRequest): string {
  return request.turnId?.trim() || randomUUID();
}

function apiBaseFromRequest(request: AgentRunRequest): string | undefined {
  const endpoint = request.telemetry?.exporters?.otlp?.endpoint?.trim();
  if (!endpoint) return undefined;
  const marker = "/otlp/";
  const idx = endpoint.indexOf(marker);
  if (idx === -1) return undefined;
  return endpoint.slice(0, idx).replace(/\/+$/, "");
}

// --- Session keep-alive dispatch (flag-gated OFF by default) ---------------- //

/**
 * The session decision logic lives in `lifecycle/session-coordinator.ts` (lifecycle migration,
 * step 3). This file kept what a transport owns: HTTP, authentication, request decoding,
 * concurrency, and the watchdog.
 *
 * The seams are re-exported below so every existing import path and test keeps working
 * unchanged. That is what makes the extraction reviewable: the diff is a move, not a rewrite.
 */
import { applyReconcilePlan } from "./environment/apply-plan.ts";
import {
  klog,
  runWithKeepalive,
  resolveKeepaliveDispatch,
  type KeepaliveEngine,
} from "./lifecycle/session-coordinator.ts";

export {
  klog,
  runWithKeepalive,
  resolveKeepaliveProvider,
  resolveKeepaliveDispatch,
  type KeepaliveContext,
  type KeepaliveEngine,
} from "./lifecycle/session-coordinator.ts";

const realKeepaliveEngine: KeepaliveEngine = {
  resolveKeepaliveMount: (request) => resolveKeepaliveMount(request),
  acquireEnvironment: (request, signal, presignedMount, emit) =>
    acquireEnvironment(request, {}, signal, presignedMount, emit),
  // Every coordinator dispatch reaches runTurn through here, so the pre-turn read lives here
  // once rather than at each of its call sites. It must happen BEFORE runTurn: that function
  // may not suspend before its permission responder is attached.
  runTurn: async (env, request, emit, signal, opts) =>
    runTurn(env, request, emit, signal, {
      ...opts,
      // After the spread so a caller-supplied set wins, and short-circuited so we never CLAIM
      // rows the spread would then discard — a claimed row is spent even if it is thrown away.
      seededDecisions:
        opts?.seededDecisions ??
        (await loadDurableDecisions(
          env.sessionId,
          runCredential(request),
          env.logger,
        )),
    }),
  // LIFECYCLE MIGRATION, STEP 6. The live-route applier. The coordinator gates on the plan being
  // entirely live-applicable; this performs it and commits applied state only if all of it landed.
  applyReconcilePlan: (env, request, plan) =>
    applyReconcilePlan(env, request, plan, klog),
  onParkedLive: async (env) => {
    if (!env.plan.isDaytona) return;
    await env.sandbox?.sandbox?.refreshActivity?.(env.sandbox.sandboxId);
  },
  // The warm-path mount probe. `mountedCwd` is set only for a LIVE LOCAL mount: Daytona records
  // an expiry with no host path (the mount lives inside the sandbox and dies with it), and a run
  // whose mount failed or was never signed falls back to an ephemeral cwd and sets nothing. In
  // every one of those cases there is no host mountpoint to probe and no claim to falsify, so the
  // answer is "alive" and the reuse proceeds unchanged.
  isMountAlive: async (env) => {
    const cwd = env.mountedCwd;
    if (!cwd) return true;
    return isMounted(cwd, klog);
  },
  // Same acquire -> runTurn -> destroy composition as `runSandboxAgent`, with the presigned
  // mount threaded through so an up-front keep-alive sign is never repeated.
  runCold: async (
    request,
    emit,
    signal,
    presignedMount,
    clientGone,
    credential,
  ) => {
    const acquired = await acquireEnvironment(
      request,
      {},
      signal,
      presignedMount,
      emit,
    );
    if (!acquired.ok) return { ok: false, error: acquired.error };
    let result: AgentRunResult | undefined;
    try {
      result = await runTurn(acquired.env, request, emit, signal, {
        loaded: acquired.env.loadedFromContinuity,
        nativeHistoryVerified: acquired.env.nativeHistoryVerified,
        ...(credential ? { credential } : {}),
        seededDecisions: await loadDurableDecisions(
          acquired.env.sessionId,
          runCredential(request),
          acquired.env.logger,
        ),
      });
      return result;
    } finally {
      // A remote sandbox parks to warm on the same policy the warm path uses. `result` is
      // undefined when runTurn threw, which is a failed turn: destroy.
      const cleanResumable =
        acquired.env.resumable &&
        result !== undefined &&
        shouldPark(result, signal, clientGone);
      await acquired.env.destroy({
        reason: cleanResumable
          ? "clean-resumable"
          : signal?.aborted || clientGone?.()
            ? "aborted"
            : "failed-turn",
      });
    }
  },
};

// One engine: `sandbox-agent` drives a harness (Pi or Claude) over ACP. The harness is
// selected by `request.harness`, not by an engine selector.
//
// Provider pools stay separate because their caps budget different resources.
const keepaliveConfigs: Record<KeepaliveProviderName, KeepaliveConfig> = {
  local: readKeepaliveConfig("local"),
  daytona: readKeepaliveConfig("daytona"),
};
const keepalivePools: Record<
  KeepaliveProviderName,
  SessionPool<SessionEnvironment>
> = {
  local: new SessionPool<SessionEnvironment>(keepaliveConfigs.local),
  daytona: new SessionPool<SessionEnvironment>(keepaliveConfigs.daytona, klog, {
    strictCapacity: true,
  }),
};

const runAgent: RunAgent = (request, emit, signal, options) => {
  const provider = resolveKeepaliveDispatch(request, keepaliveConfigs);
  if (!provider) {
    return runSandboxAgent(
      request,
      emit,
      signal,
      {},
      {
        ...(options?.credential ? { credential: options.credential } : {}),
      },
    );
  }
  const config = keepaliveConfigs[provider];
  return runWithKeepalive(request, emit, signal, {
    engine: realKeepaliveEngine,
    pool: keepalivePools[provider],
    config,
    clientGone: options?.clientGone,
    credential: options?.credential,
    // The coordinator is the first place that knows this run's project, because the scope can
    // come from the signed mount rather than the request. A control command needs it to tell
    // one tenant's session from another's.
    onScopeResolved: (projectId) => {
      const sessionId = request.sessionId?.trim();
      const turnId = request.turnId?.trim();
      if (sessionId && turnId)
        noteExecutionProject(sessionId, turnId, projectId);
    },
  });
};

/**
 * The stale-cancel exemptions for a parked approval set. A partial live resume owns both the
 * answered and carried gates, so any answer spares every parked token; zero answers spare none.
 */
export function staleInteractionExemptTokens(
  request: AgentRunRequest,
  parked: ReadonlyMap<string, ParkedApproval>,
): string[] | undefined {
  const hasAnswer = [...parked.values()].some(
    (gate) =>
      approvalDecisionForToolCall(request, gate.toolCallId) !== undefined,
  );
  return hasAnswer
    ? [...parked.values()].map((gate) => gate.interactionToken)
    : undefined;
}

/**
 * A live partial resume owns the whole parked set, including unanswered gates it carries into the
 * next pause. Once any parked gate is answered, the stale sweep must spare every parked token; a
 * zero-answer request owns none and receives no exemptions.
 */
function inBandAnswerTokens(request: AgentRunRequest): string[] | undefined {
  const sessionId = request.sessionId?.trim();
  if (!sessionId) return undefined;
  const provider = resolveKeepaliveDispatch(request, keepaliveConfigs);
  if (!provider) return undefined;
  const parked =
    keepalivePools[provider].awaitingApproval(sessionId)?.environment
      .parkedApprovals;
  if (!parked || parked.size === 0) return undefined;
  return staleInteractionExemptTokens(request, parked);
}

/**
 * Stream a run as NDJSON: one `{kind:"event"}` line per event the moment it is built, then
 * exactly one terminal `{kind:"result"}` line (success or failure). Selected by the caller
 * with `Accept: application/x-ndjson`; the one-shot `/run` path is left untouched.
 *
 * For session-owned runs (a sessionId is present; the turnId is runner-minted):
 *  - the run survives client disconnect (abort is NOT wired to the response close event);
 *  - every event is persisted producer-side via the record ingest endpoint;
 *  - an alive-lock watchdog heartbeats the coordination plane for the run's lifetime.
 */
async function runAndStream(
  _req: IncomingMessage,
  res: ServerResponse,
  request: AgentRunRequest,
  run: RunAgent,
): Promise<void> {
  // scope the inferred api base to this request (AsyncLocalStorage), not a process
  // global — a second concurrent request with a different base must not be pinned to the first.
  const requestApiBase = apiBaseFromRequest(request);
  if (requestApiBase) {
    return runWithRequestApiBase(requestApiBase, () =>
      runAndStreamWithApiBaseResolved(res, request, run),
    );
  }
  return runAndStreamWithApiBaseResolved(res, request, run);
}

async function runAndStreamWithApiBaseResolved(
  res: ServerResponse,
  request: AgentRunRequest,
  run: RunAgent,
): Promise<void> {
  res.writeHead(200, {
    "content-type": "application/x-ndjson",
    "cache-control": "no-cache",
    "x-accel-buffering": "no",
    connection: "keep-alive",
  });

  const sessionOwned = isSessionOwned(request);
  const sessionId = request.sessionId!;
  const turnId = resolveTurnId(request);
  // Write the resolved id back: every downstream reader of `request.turnId` (the turns-ledger
  // append, interaction rows) must see the SAME execution id the alive-lock and records use.
  request.turnId = turnId;

  // Diagnostic: surface whether the session-owned persist/alive path is entered and whether the
  // invoke credential arrived. Empty cred => heartbeat/persist would 401. The two empty cases have
  // different fixes, so name them apart: ABSENT means the caller sent no credential, DROPPED means
  // one arrived but did not attribute to this platform (see `platformCredentialForRequest`).
  const credentialState = platformCredentialForRequest(request)
    ? "present"
    : runCredential(request)
      ? "DROPPED(endpoint-not-agenta-ingest)"
      : "ABSENT(caller-sent-none)";
  process.stderr.write(
    `[sessions] stream sessionOwned=${sessionOwned} sessionId=${sessionId ?? "-"} turnId=${turnId ?? "-"} cred=${credentialState}\n`,
  );

  // Session-owned runs survive client disconnect — the runner owns the run. Non-session
  // runs abort on disconnect (original behavior: caller drives, disconnect = cancel).
  const controller = new AbortController();
  let clientDisconnected = false;
  // Resolves when the platform tells us this turn is no longer current — a Stop, a takeover,
  // or the API's own execution watchdog having declared the turn lost. `awaitTurnOrAbandon`
  // uses it to stop waiting on a run that may never return. See `sessions/turn-settle.ts`.
  let markInterrupted: ((reason: string) => void) | undefined;
  const interrupted = new Promise<string>((resolve) => {
    markInterrupted = resolve;
  });
  if (!sessionOwned) {
    // Listen on the response, not the request: the request body is already fully read, so
    // its `close` can fire early on a keep-alive connection. `res` `close` fires when the
    // response connection ends — after a normal `res.end()` (harmless: the run is already
    // done) or when the client drops mid-stream (the case we want to cancel).
    res.on("close", () => controller.abort());
  } else {
    // Session-owned: the run signal is deliberately NOT aborted (the run must survive the
    // disconnect and finish), but keep-alive's park decision must still see the disconnect —
    // a disconnected client's session is destroyed at turn end, never parked. The flag is
    // only read while the run is in flight, so the close that follows a normal `res.end()`
    // (after the run resolved) can never affect a park decision.
    res.on("close", () => {
      clientDisconnected = true;
    });
  }

  const writeRecord = (record: StreamRecord): void => {
    if (res.writableEnded) return;
    res.write(JSON.stringify(record) + "\n");
  };
  const liveEmit: EmitEvent = (event) => writeRecord({ kind: "event", event });
  const turn = currentUserTurn(request);
  const attachmentError = attachmentCountError(turn.attachments.length);
  if (attachmentError) {
    writeRecord({
      kind: "result",
      result: { ok: false, error: attachmentError, events: [] },
    });
    res.end();
    return;
  }

  // For session-owned runs: wrap the live emitter so every event is also persisted
  // producer-side, independent of whether the client is still connected.
  let emitFn: EmitEvent = liveEmit;
  // Closed once this request has written the turn's terminal outcome. An abandoned run may
  // still unwind minutes later and emit its own `error`/`done` through the same emitter; the
  // turn already has an ending, and a second one would put two endings in one transcript.
  let turnClosed = false;
  const gatedEmit: EmitEvent = (event) => {
    if (turnClosed) return;
    emitFn(event);
  };
  let flushPersist: (() => Promise<void>) | undefined;
  let persistError:
    | ((message: string, code?: RunErrorCode) => void)
    | undefined;
  let persistTerminal: ((stopReason?: string) => void) | undefined;
  let terminalRecordEmitted = false;
  let aliveWatchdog:
    | {
        release: () => Promise<void>;
        credential: () => string;
      }
    | undefined;

  try {
    if (sessionOwned) {
      // The request's api base (if any) is already scoped for this call via
      // runWithRequestApiBase in the outer runAndStream — apiBase() below sees it.
      // The runner authenticates session calls AS the invoke caller (the run credential),
      // refreshing it for the turn's lifetime — never the admin key. Project scope is
      // resolved server-side from the credential, so no project_id rides the request.
      //
      // onInterrupted (W7.4): a cancel/steer/kill against this session (via
      // `POST /sessions/streams/` or the runner's own `/kill`) drops this turn's alive lock.
      // The next heartbeat surfaces that as `is_current_turn: false`; wiring it to
      // `controller.abort()` is what makes the control-plane signal actually reach this
      // in-flight run — before this, a session-owned run's controller was never aborted.
      // Awaited (WP3) so the first heartbeat's stream_id is ready before the turn starts.
      //
      // The beat also proposes the two things a headless session otherwise never gets: a name
      // (no browser ever renders it, and the browser is the only other title writer) and the
      // run's workflow references (they ride only a fire-and-forget turn append today, so a
      // dropped append leaves a row the UI cannot open). Both are fill-once server-side.
      const watchdog = await startAliveWatchdog(
        sessionId,
        turnId,
        platformCredentialForRequest(request),
        () => {
          markInterrupted?.(
            "the platform reported this turn is no longer current (stopped, taken over, or " +
              "declared lost)",
          );
          // LABELLED, not a bare abort: `shouldPark` parks only an abort it can prove was a
          // cooperative Stop. See `sessions/stop-signal.ts`.
          controller.abort(USER_STOP_ABORT_REASON);
        },
        {
          name: proposeSessionName(request),
          references: buildWorkflowReferenceList(request.runContext?.workflow),
        },
      );
      aliveWatchdog = watchdog;
      // The heartbeat response already carries the session_streams row id — free, no extra
      // round-trip. Thread it onto the request so the engine's turn-append write has it.
      request.streamId = watchdog.streamId();

      // ADMISSION. That first beat asked the platform's atomic `nx` acquire whether this turn may
      // run, and `admitted: false` means a DIFFERENT turn already holds the session. Stop here.
      //
      // Everything below this point has a side effect that a refused turn must not have:
      // `cancelStaleInteractions` would cancel the LIVE turn's unanswered approval gate, the
      // persisting emitter would write this message into the durable transcript, and `run()` would
      // reach the keepalive pool and destroy the live turn's warm environment. That last one is
      // the double-send bug (#6417, #5539, #5538): the arbiter's answer was already correct, the
      // runner simply never read it before acting.
      //
      // The refusal travels as an `error` EVENT with a stable code plus a failed terminal result,
      // which is the path every runner failure already takes to the browser. Nothing is persisted,
      // so the refused message never appears in the session's history — the client keeps the text.
      if (!watchdog.admitted) {
        process.stderr.write(
          `[sessions] admission REFUSED session=${sessionId} turn=${turnId}; ` +
            `another turn owns this session. No pool resolve, no eviction.\n`,
        );
        // Stops the heartbeat interval and releases the credential lease. Its final
        // `is_running: false` beat is owner-scoped server-side, so it cannot clear the live
        // turn's `running` lock or stamp its own turn id on the session row.
        await watchdog.release().catch(() => {});
        unregisterExecution(sessionId, turnId);
        liveEmit({
          type: "error",
          message: SESSION_TURN_IN_USE_MESSAGE,
          code: SESSION_TURN_IN_USE_CODE,
        });
        writeRecord({
          kind: "result",
          result: { ok: false, error: SESSION_TURN_IN_USE_MESSAGE, events: [] },
        });
        res.end();
        return;
      }

      // A refused contender must never replace the admitted execution's Stop handle.
      registerExecution({
        projectId: projectScopeFor(request, undefined)?.id,
        sessionId,
        turnId,
        startedAt: Date.now(),
        abort: () => controller.abort(USER_STOP_ABORT_REASON),
      });

      // Admitted. Tell the client which execution it is watching, before anything else streams.
      //
      // The runner mints the turn id (`resolveTurnId`), and until now it never told anyone: the
      // client's `start` frame is built and sent before the runner replies at all, so it cannot
      // carry a runner-minted id. That is why `expected_execution_id` on the public Cancel has had
      // no first-party caller able to fill it — a Stop could only mean "whatever is running now",
      // never "the turn I was watching". This is the earliest frame that can carry it.
      //
      // Deliberately on `liveEmit`, not the persisting emitter that replaces it below: this is
      // transport correlation, not conversation, and it must never become a session record.
      liveEmit({ type: "turn", turnId });

      // A new turn supersedes any prior turn's unanswered gate: cancel stale pending
      // interactions (sparing this turn's own, plus a parked gate this turn answers in-band —
      // the resume resolves that one). Best-effort, never blocks the turn.
      const answeredTokens = inBandAnswerTokens(request);
      void cancelStaleInteractions(
        sessionId,
        turnId,
        answeredTokens,
        watchdog.credential,
      );
      // Deny-set from THIS run's typed credential material (model connection credentials +
      // materialized environment values + MCP connection credentials) and the run credential —
      // not process env, which never holds them. A credential value a model echoes back must
      // never reach the durable session records unredacted.
      const {
        emit: persistingEmit,
        persist,
        flush,
      } = buildPersistingEmitter(
        sessionId,
        watchdog.credential,
        liveEmit,
        seedForRun(request),
        turnId,
        request.runContext?.trace?.span_id,
      );
      // Record the inbound user turn first so the session record is the full conversation, not just
      // agent output. Guard on `tailIsFreshUserMessage`: an approval RESUME's tail is the tool_result
      // envelope, so it must not re-persist the ORIGINAL prompt as a duplicate user row. The guard
      // writes the prompt only on the turn that first introduced it.
      if (tailIsFreshUserMessage(request)) {
        persist(
          { type: "message", text: turn.text, attachments: turn.attachments },
          "user",
        );
        if (turn.attachments.length > 0) {
          // A failed claim is accepted as graceful loss: the worst case is that the sweeper
          // reclaims the attachment and cold replay renders it as no longer available.
          await claimAttachments(
            sessionId,
            turn.attachments.map((attachment) => attachment.attachmentId),
            watchdog.credential,
          );
        }
      }
      emitFn = (event) => {
        if (event.type === "done") terminalRecordEmitted = true;
        persistingEmit(event);
      };
      flushPersist = flush;
      persistError = (message, code) =>
        persist({ type: "error", message, ...(code ? { code } : {}) }, "agent");
      persistTerminal = (stopReason) => {
        terminalRecordEmitted = true;
        persist(
          {
            type: "done",
            ...(stopReason === "cancelled" ? { stopReason } : {}),
          },
          "agent",
        );
      };
    }
  } catch (error) {
    if (aliveWatchdog) await aliveWatchdog.release().catch(() => {});
    if (sessionOwned) unregisterExecution(sessionId, turnId);
    throw error;
  }

  let result: AgentRunResult;
  try {
    // Not a bare `await run(...)`: an await inside the run that never settles would keep this
    // function parked forever, and with it the terminal record below AND the alive watchdog's
    // release in the `finally` — the turn would announce `running=true` every 30s for good.
    // `awaitTurnOrAbandon` returns either the run's own result or a reason to write one
    // without it, so this request always produces exactly one terminal outcome.
    const outcome = await awaitTurnOrAbandon({
      run: run(request, gatedEmit, controller.signal, {
        clientGone: () => clientDisconnected,
        credential: aliveWatchdog?.credential,
      }),
      abort: () => controller.abort(),
      interrupted: sessionOwned ? interrupted : undefined,
      limits: resolveTurnSettleLimits((message) =>
        process.stderr.write(`${message}\n`),
      ),
      log: (message) => process.stderr.write(`${message}\n`),
    });
    if (outcome.settled) {
      result = outcome.value;
      // `runTurn` normally emits `done` itself. Acquisition can fail before `runTurn` starts,
      // though, and a cooperative Stop during a cold sandbox create reaches exactly that path.
      // Close any failed run that emitted no terminal record; preserve the Stop marker when the
      // labelled control-plane abort caused it. A genuine acquire failure never reached runTurn's
      // error emitter, so preserve its error before the done backstop instead of making the empty
      // turn look successful. Both records use the same ordered persistence chain as runTurn's
      // emitter but stay off the live stream, whose result envelope is unchanged.
      if (
        !terminalRecordEmitted &&
        persistTerminal &&
        (!result.ok || isUserStopAbort(controller.signal))
      ) {
        const userStopped = isUserStopAbort(controller.signal);
        if (!userStopped && !result.ok && persistError) {
          persistError(result.error ?? "Agent run failed.");
        }
        persistTerminal(userStopped ? "cancelled" : undefined);
      }
    } else {
      // The run is still pending and may never settle. Give the turn the ending the runner
      // owes it, and let the abandoned run keep its own teardown if it ever unwinds.
      turnClosed = true;
      const message = `${ABANDONED_TURN_MARKER}: ${outcome.reason}`;
      process.stderr.write(
        `[sessions] ABANDONED session=${sessionId ?? "-"} turn=${turnId ?? "-"}: ${outcome.reason}\n`,
      );
      if (persistError) persistError(message, "execution_lost");
      result = { ok: false, error: message };
    }
    // Drain the terminal backstop or abandonment marker and all prior persists before the
    // sandbox tears down.
    if (flushPersist) await flushPersist();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Stack stays server-side; the message alone goes on the wire and into the transcript.
    // Server-side is still a sink: an escaping error can capture this run's live credentials
    // in its message/stack (an auth failure echoing the key, a dumped env), so the stack runs
    // through the run's own deny-set before it reaches stderr — same seed the persisting
    // emitter uses (`seedForRun(request)`), keeping the log shape intact with values scrubbed.
    if (err instanceof Error && err.stack) {
      console.error(seedForRun(request).redactString(err.stack, "stderr"));
    }
    // A throw escaping run() itself (outside the engine's own try/catch) emitted no error
    // event — persist it here as the backstop.
    if (persistError) persistError(message);
    if (
      !terminalRecordEmitted &&
      persistTerminal &&
      isUserStopAbort(controller.signal)
    ) {
      persistTerminal("cancelled");
    }
    if (flushPersist) await flushPersist().catch(() => {});
    result = { ok: false, error: message };
  } finally {
    // The drain is the only place that knows whether this turn's records all landed. A dropped
    // record means the log no longer represents the conversation, so mark the session: a later
    // turn must fail rather than rebuild model context from a log with a hole in it.
    if (sessionOwned && sessionId) {
      const dropped = takePersistFailures(sessionId);
      if (dropped > 0) {
        noteRecordsIncomplete(sessionId);
        process.stderr.write(
          `[sessions] records INCOMPLETE session=${sessionId} dropped=${dropped}; ` +
            `reconstruction disabled for this session\n`,
        );
      }
    }
    if (aliveWatchdog) await aliveWatchdog.release().catch(() => {});
    // Same `finally` as the watchdog release, so a run that threw still leaves the registry
    // clean. Scoped to this turn id, so a turn that finishes after its successor registered
    // cannot unregister the successor.
    if (sessionOwned) unregisterExecution(sessionId, turnId);
  }

  // Streaming delivered the events live, so don't echo them in the terminal record.
  writeRecord({ kind: "result", result: { ...result, events: [] } });
  res.end();
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * Normalize `/kill`'s `projectId` to `undefined` for both absent and whitespace-only input. A
 * blank string surviving as `""` would make `poolKeyFor` and `destroyInFlightSandboxesForSession`
 * disagree on scope: the former forms no pool key from an empty project id (so keepalive pool
 * entries are NOT destroyed), while the latter treats `""` as "no project filter" and still
 * destroys every in-flight sandbox for the session regardless of project.
 */
export function normalizeKillProjectId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

/** `/kill`'s payload is `{ sessionId, projectId }` — a few hundred bytes at most. */
const KILL_BODY_MAX_BYTES = 16 * 1024;

/** Thrown by `readBodyCapped` when the request exceeds `maxBytes`; the caller maps it to 413. */
class BodyTooLargeError extends Error {}

/** Same streaming byte-count-and-reject shape as tool-mcp-http.ts's `readBody`, so a caller
 *  cannot force the runner to buffer an arbitrarily large body before JSON parsing. */
function readBodyCapped(
  req: IncomingMessage,
  maxBytes: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new BodyTooLargeError("request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/** `/cancel`'s payload is five short strings. */
const CANCEL_BODY_MAX_BYTES = 16 * 1024;

/** A non-empty trimmed string, or null. Used for every id `/cancel` reads. */
function readRequiredId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

/**
 * Does the keep-alive pool hold this session parked awaiting an approval?
 *
 * A Stop against a parked approval has no entry in the execution registry, because no turn is
 * running. Without this lookup the runner would answer 404 for exactly the case that has no
 * control channel at all today: a parked session stops heartbeating, so the only existing Stop
 * signal never reaches it.
 */
function parkedSessionControl(
  projectId: string,
  sessionId: string,
): ParkedSessionControl | undefined {
  const key = `${projectId}:${sessionId}`;
  for (const provider of Object.keys(
    keepalivePools,
  ) as KeepaliveProviderName[]) {
    const pool = keepalivePools[provider];
    const parked = pool.get(key);
    if (!parked || parked.state !== "awaiting_approval") continue;
    return {
      stop: async () => {
        // Checkout makes the transition exclusive: a racing request cannot consume the same
        // permission gate while Stop is releasing it.
        const live = pool.checkoutApproval(key);
        if (!live) throw new Error("parked approval was already checked out");
        const env = live.environment;
        const gates = [...env.parkedApprovals.values()];
        try {
          await Promise.all(
            gates.map((gate) =>
              env.session.respondPermission(gate.permissionId, "reject"),
            ),
          );
          env.parkedApprovals.clear();
          env.parkedApproval = undefined;
          env.parkedApprovedExecutions?.clear();
          env.approvalGateCount = 0;
          env.nonParkablePauseCount = 0;
          env.commitAuthorization = undefined;
          env.clearTurn();
          const reparked = await pool.repark(
            live,
            {
              historyFingerprint: live.historyFingerprint,
              historyAsserted: live.historyAsserted,
              credentialEpoch: live.credentialEpoch,
            },
            keepaliveConfigs[provider].stoppedTtlMs ??
              keepaliveConfigs[provider].ttlMs,
          );
          if (!reparked) {
            await live.teardown("failed-turn");
            throw new Error("released approval could not return to the pool");
          }
        } catch (error) {
          // A partly released gate set is not safe to present as awaiting approval again. Fail
          // closed through the normal teardown path; applyCommand reports the failed outcome.
          await pool.evictIfCurrent(live, "stop-approval-failed", "failed-turn");
          throw error;
        }
      },
    };
  }
  return undefined;
}

/** Build the HTTP request listener around a given engine runner (the testable seam). */
export function createRequestListener(
  run: RunAgent,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res) => {
    try {
      if (req.method === "GET" && req.url === "/health") {
        return send(res, 200, runnerInfo());
      }

      // Deployment state, not project data — but it is still operator state, so it sits behind the
      // same token gate as /kill and /stream. /health stays the only unauthenticated route.
      if (req.method === "GET" && req.url === "/subscription-status") {
        if (!isAuthorized(req)) {
          return send(res, 401, { ok: false, error: "Unauthorized" });
        }
        return send(res, 200, await subscriptionStatusResponse());
      }

      if (req.method === "POST" && req.url === "/kill") {
        if (!isAuthorized(req)) {
          return send(res, 401, { ok: false, error: "Unauthorized" });
        }
        // Scoped, idempotent, best-effort: both sessionId and projectId are required so the
        // pool-key drain and the in-flight sandbox sweep agree on exactly one tenant's session
        // (pool keys are always project-scoped; see `poolKeyFor`).
        let killBody: { sessionId?: unknown; projectId?: unknown };
        try {
          const raw = await readBodyCapped(req, KILL_BODY_MAX_BYTES);
          killBody = raw.trim() ? JSON.parse(raw) : {};
        } catch (err) {
          if (err instanceof BodyTooLargeError) {
            return send(res, 413, { ok: false, error: err.message });
          }
          return send(res, 400, {
            ok: false,
            error: `Invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
        const sessionId =
          typeof killBody.sessionId === "string"
            ? killBody.sessionId.trim()
            : "";
        const projectId = normalizeKillProjectId(killBody.projectId);
        if (!sessionId || !projectId) {
          return send(res, 400, {
            ok: false,
            error:
              "sessionId and projectId are both required: /kill must be scoped to exactly one tenant's session",
          });
        }
        const scope = poolKeyFor(
          { sessionId, runContext: { project: { id: projectId } } },
          projectId,
        );
        await Promise.all(
          Object.values(keepalivePools).map((pool) =>
            scope ? pool.destroy(scope.key, "kill") : Promise.resolve(),
          ),
        );
        await destroyInFlightSandboxesForSession(
          sessionId,
          projectId,
          5000,
          "kill",
        );
        return send(res, 200, { ok: true });
      }

      if (req.method === "POST" && req.url === "/cancel") {
        if (!isAuthorized(req)) {
          return send(res, 401, { ok: false, error: "Unauthorized" });
        }
        // Stop the CURRENT TURN and keep the session warm. This is not `/kill`: the sandbox,
        // the native harness session and the keep-alive pool entry all survive, and the next
        // message continues the same conversation.
        //
        // The response is an ACKNOWLEDGEMENT, not an outcome. What happened to the execution
        // goes to the API's outcome route, so settlement has one path on every transport.
        let cancelBody: {
          commandId?: unknown;
          projectId?: unknown;
          sessionId?: unknown;
          targetTurnId?: unknown;
          createdAt?: unknown;
        };
        try {
          const raw = await readBodyCapped(req, CANCEL_BODY_MAX_BYTES);
          cancelBody = raw.trim() ? JSON.parse(raw) : {};
        } catch (err) {
          if (err instanceof BodyTooLargeError) {
            return send(res, 413, { ok: false, error: err.message });
          }
          return send(res, 400, {
            ok: false,
            error: `Invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
        const commandId = readRequiredId(cancelBody.commandId);
        const cancelSessionId = readRequiredId(cancelBody.sessionId);
        const cancelProjectId = readRequiredId(cancelBody.projectId);
        if (!commandId || !cancelSessionId || !cancelProjectId) {
          return send(res, 400, {
            ok: false,
            error:
              "commandId, sessionId and projectId are all required: a pool key is always project-scoped",
          });
        }
        const command: ControlCommand = {
          id: commandId,
          projectId: cancelProjectId,
          sessionId: cancelSessionId,
          kind: "cancel",
          target: {
            turnId: readRequiredId(cancelBody.targetTurnId),
            expectedTurnId: null,
          },
          createdAt:
            typeof cancelBody.createdAt === "string"
              ? cancelBody.createdAt
              : "",
        };
        if (
          !holdsSession(
            cancelProjectId,
            cancelSessionId,
            parkedSessionControl,
          )
        ) {
          // 404 is ambiguous on purpose and the API disambiguates it: a `not_held` for a
          // session whose row is alive and beating means the call reached the wrong replica.
          return send(res, 404, { ok: false, error: "session not held here" });
        }
        // Answer before the outcome. The applier reports it separately, and a Stop that takes
        // seconds to settle must not hold this request open.
        void applyCommand(command, {
          isParked: parkedSessionControl,
        }).catch(() => {});
        return send(res, 202, { ok: true, replicaId: REPLICA_ID });
      }

      // POST /stream is the productized name; /run is kept as a back-compat alias
      // for one release (the SDK still posts /run). Both share the handler.
      if (
        req.method === "POST" &&
        (req.url === "/stream" || req.url === "/run")
      ) {
        if (!isAuthorized(req)) {
          return send(res, 401, { ok: false, error: "Unauthorized" });
        }

        // Per-box admission gate: reject before doing any work when this replica
        // is already at its in-flight limit. Reserve the slot for the whole run and release
        // it in `finally`, whichever path (streaming or one-shot) is taken.
        const limit = concurrencyLimit();
        if (inFlight >= limit) {
          return send(res, 429, {
            ok: false,
            error: `Runner at capacity (${limit} concurrent runs)`,
          });
        }
        inFlight += 1;
        try {
          const raw = await readBody(req);
          let request: AgentRunRequest;
          try {
            request = raw.trim() ? (JSON.parse(raw) as AgentRunRequest) : {};
          } catch (err) {
            return send(res, 400, {
              ok: false,
              error: `Invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
            });
          }

          const wantsStream = (req.headers["accept"] ?? "").includes(
            "application/x-ndjson",
          );
          if (wantsStream) {
            await runAndStream(req, res, request, run);
            return;
          }

          // DEVELOPMENT-ONLY: the one-shot JSON path. The live agent always requests NDJSON
          // (Accept: application/x-ndjson) and the SDK coalesces the batch result from the
          // stream. This coalesced JSON response is kept only for local debugging of /run; no
          // live caller hits it. Do not build new behavior on this branch.
          const oneShotApiBase = apiBaseFromRequest(request);
          const result = oneShotApiBase
            ? await runWithRequestApiBase(oneShotApiBase, () => run(request))
            : await run(request);
          return send(res, result.ok ? 200 : 500, result);
        } finally {
          inFlight -= 1;
        }
      }

      return send(res, 404, { ok: false, error: "Not found" });
    } catch (err) {
      // Only .message goes on the wire: the raw thrown value (even via String()) is
      // stack-trace-tainted to CodeQL, and the stack itself stays server-side.
      const message = err instanceof Error ? err.message : "Internal error";
      console.error(err instanceof Error ? (err.stack ?? err.message) : err);
      return send(res, 500, { ok: false, error: message });
    }
  };
}

/** Create the sidecar HTTP server. Defaults to the real engine dispatch; tests pass a fake. */
export function createAgentServer(run: RunAgent = runAgent): Server {
  return createServer(createRequestListener(run));
}

/**
 * Register a shutdown handler that best-effort deletes any in-flight sandbox(es) before exit.
 *
 * Without this, `docker stop` (SIGTERM) kills the process while the per-run `finally` in
 * `runSandboxAgent` is still waiting on the harness — so the sandbox it created is never deleted
 * and leaks (a Daytona credit-burner). The handler drains the in-flight registry, then exits.
 *
 * It is timeout-bounded so it can NEVER hang shutdown: `destroyInFlightSandboxes` races the
 * deletes against its own timeout, and if the SIGTERM grace period elapses the orchestrator's
 * SIGKILL ends the process anyway (the Daytona auto-stop backstop in `provider.ts` covers that
 * unreachable case). The handler installs once and is idempotent against a repeated signal.
 *
 * Injectable (`onCleanup` / `exit`) so a test can drive it without killing the test process.
 */
export function registerShutdownHandler({
  onCleanup = destroyInFlightSandboxes,
  exit = (code: number) => process.exit(code),
  signals = ["SIGTERM", "SIGINT"] as const,
}: {
  onCleanup?: (timeoutMs?: number) => Promise<void>;
  exit?: (code: number) => void;
  signals?: readonly NodeJS.Signals[];
} = {}): void {
  let shuttingDown = false;
  const handle = (signal: NodeJS.Signals): void => {
    if (shuttingDown) return; // a second signal must not race a second cleanup
    shuttingDown = true;
    process.stderr.write(
      `[sandbox-agent] received ${signal}, cleaning up in-flight sandboxes\n`,
    );
    void onCleanup()
      .catch(() => {})
      .finally(() => exit(0));
  };
  for (const signal of signals) process.on(signal, handle);
}

// Only run as a server when this file is the process entry (`tsx src/server.ts`); importing
// it (e.g. from a test) is inert.
if (isEntrypoint(import.meta.url)) {
  // The sandbox-agent SDK can reject a background promise (e.g. an adapter install or the Daytona
  // preview SSE failing) outside any awaited path. Node's default turns that into an
  // uncaught exception that kills the whole process — taking every in-flight request with
  // it (the caller sees "Server disconnected"). Log and keep serving instead; the failing
  // run still returns its own error to its caller.
  process.on("unhandledRejection", (reason) => {
    process.stderr.write(
      `[sandbox-agent] unhandledRejection: ${reason instanceof Error ? (reason.stack ?? reason.message) : String(reason)}\n`,
    );
  });
  process.on("uncaughtException", (err) => {
    process.stderr.write(
      `[sandbox-agent] uncaughtException: ${err.stack ?? err.message}\n`,
    );
  });

  // On `docker stop` (SIGTERM) / Ctrl-C (SIGINT), drain the keep-alive pool (its complete
  // per-session destroy) and then delete any sandbox a run created, so a kill does not leak a
  // parked session or an in-flight sandbox (the per-run teardown never runs on a process kill).
  registerShutdownHandler({
    onCleanup: async (timeoutMs?: number) => {
      await Promise.all(
        Object.values(keepalivePools).map((pool) =>
          pool.destroyAll(timeoutMs, "shutdown-idle", "shutdown-in-flight"),
        ),
      );
      await destroyInFlightSandboxes(timeoutMs, "shutdown-in-flight");
      // LAST, and only after the sandboxes are gone: hand back the `owner:session:<id>`
      // affinity keys this replica holds. Nothing else releases them, and `claim_owner` never
      // steals, so without this the replacement replica is refused every message on those
      // sessions for the rest of the 120-second lease. It runs last because a session whose
      // sandbox is still being destroyed should not yet look free to another replica, and it
      // is bounded so it can never hold the process past the SIGTERM grace period. A SIGKILL
      // reaches no handler at all; the lease stays the fallback for that.
      await releaseOwnedSessions(timeoutMs);
    },
  });

  // Parse and validate the operator configuration ONCE before listening. An invalid
  // configuration (empty/unknown provider list, default not enabled, Daytona enabled without a
  // credential, mutually exclusive artifact, invalid lifecycle values) fails startup here. Log
  // one redacted summary, then bridge the typed Daytona credential into the ambient names the
  // vendored SDK reads during sandbox creation.
  const runnerConfig = loadRunnerConfig();
  // The shared token is required to SERVE, but not to parse config: the per-request config reads
  // (provider defaults) must not depend on an auth secret. So it is asserted here, at the one
  // boundary that exposes the HTTP surface, and nowhere else.
  assertRunnerToken(runnerConfig.server.token);
  process.stderr.write(
    `[sandbox-agent] ${runnerConfigSummary(runnerConfig)}\n`,
  );
  if (runnerConfig.providers.enabled.includes("daytona")) {
    applyDaytonaSdkEnv(runnerConfig.daytona);
  }

  createAgentServer().listen(
    runnerConfig.server.port,
    runnerConfig.server.host,
    () => {
      process.stderr.write(
        `[sandbox-agent] http server listening on ${runnerConfig.server.host}:${runnerConfig.server.port}\n`,
      );
      if (!publicApiBaseConfigured()) {
        const internalApiHost = process.env.AGENTA_API_INTERNAL_URL
          ? endpointHost(process.env.AGENTA_API_INTERNAL_URL)
          : "unset";
        process.stderr.write(
          "[sandbox-agent] WARNING: AGENTA_API_URL is not set. Dispatched runs carry this " +
            "deployment's PUBLIC api base in their trace endpoint, so without it the runner " +
            "cannot tell its own api from a third-party collector and cannot attribute the run " +
            "credential. Set AGENTA_API_URL to the public api base (e.g. https://<host>/api); " +
            `AGENTA_API_INTERNAL_URL host (${internalApiHost}) is the ` +
            "in-network hop and does not substitute for it.\n",
        );
      }
      if (insecureEgressAllowed()) {
        process.stderr.write(
          "[sandbox-agent] WARNING: AGENTA_INSECURE_EGRESS_ALLOWED is set: user MCPs may " +
            "target http and private/loopback/metadata hosts. Use only for trusted/single-tenant deployments.\n",
        );
      } else {
        process.stderr.write(
          "[sandbox-agent] Outbound egress is in restricted mode: user MCPs must use https and " +
            "public hosts (private/loopback/link-local/metadata targets are blocked).\n",
        );
      }
    },
  );
}
