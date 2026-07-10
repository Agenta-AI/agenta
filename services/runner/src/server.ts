/**
 * Agent runner HTTP server: the HTTP transport for the Harness port.
 *
 * Same contract as the CLI, exposed over HTTP so the wrapper can run as its own
 * container (a sidecar) that the Python service calls in-network:
 *
 *   GET  /health -> runner identity ({ status, runner, protocol, engines, harnesses })
 *   POST /stream -> body is an AgentRunRequest, NDJSON event stream (alias: POST /run)
 *   POST /kill   -> best-effort, idempotent teardown of in-flight sandboxes
 *
 * Uses Node's built-in http server (no framework dependency).
 *
 * `createAgentServer(run)` is the testable seam: it builds the server around an injectable
 * engine runner so the HTTP behavior can be tested with a fake engine (no live harness).
 */
import { apiBase, runWithRequestApiBase } from "./apiBase.ts";
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
import { resolvePromptText } from "./protocol.ts";
import {
  acquireEnvironment,
  destroyInFlightSandboxes,
  resolveKeepaliveMount,
  runSandboxAgent,
  runTurn,
  type RunTurnOptions,
  type SessionEnvironment,
} from "./engines/sandbox_agent.ts";
import type { MountCredentials } from "./engines/sandbox_agent/mount.ts";
import {
  approvalDecisionForToolCall,
  computeCredentialEpoch,
  configFingerprint,
  credentialEpochMismatch,
  mountCredentialsExpired,
  expectedNextHistoryFingerprint,
  historyFingerprint,
  poolKeyFor,
  priorConversation,
  readKeepaliveConfig,
  resolvesToLocalProvider,
  SessionPool,
  tailIsFreshUserMessage,
  type KeepaliveConfig,
  type LiveSession,
} from "./engines/sandbox_agent/session-pool.ts";
import { runnerInfo } from "./version.ts";
import { isEntrypoint } from "./entry.ts";
import { insecureEgressAllowed } from "./tools/ssrf-guard.ts";
import { startAliveWatchdog } from "./sessions/alive.ts";
import { cancelStaleInteractions } from "./sessions/interactions.ts";
import { buildPersistingEmitter } from "./sessions/persist.ts";

const PORT = Number(process.env.AGENTA_RUNNER_PORT ?? 8765);

// Bind to loopback by default (sidecar-trust step 1): the `/run` body carries plaintext
// provider secrets and reusable bearer tokens, so the sidecar MUST sit on a trusted,
// non-public network. `127.0.0.1` keeps it reachable only from the same host (the co-located
// Python service) and never `0.0.0.0`. In Kubernetes/Compose, set `AGENTA_RUNNER_HOST`
// to the private pod/internal-network interface; never publish the port to the host.
const HOST = process.env.AGENTA_RUNNER_HOST ?? "127.0.0.1";

// Optional shared `/run` token (sidecar-trust step 2): default OFF. When
// `AGENTA_RUNNER_TOKEN` is set, every `/run` request must present the same secret (in
// `Authorization: Bearer <token>` or `X-Agenta-Runner-Token: <token>`); otherwise it is
// rejected with 401. Cheap defense-in-depth against accidental exposure on top of network
// isolation; a static shared secret is not a substitute for TLS (deferred). Unset = no check,
// so co-located/loopback deployments are unaffected.
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

/**
 * Whether this `/run` request is authorized. The check is OFF unless the operator opts in by
 * setting `AGENTA_RUNNER_TOKEN`; when set, the presented token must match exactly.
 */
function isAuthorized(req: IncomingMessage): boolean {
  const expected = process.env[RUNNER_TOKEN_ENV];
  if (!expected) return true; // default-off: no token configured, accept (network isolation only)
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

/**
 * The invoke caller's Agenta credential, used to authenticate session coordination calls AS
 * the caller. It rides the telemetry exporter headers (where the run's Agenta secret already
 * lives, kept verbatim). Empty string if absent.
 */
function runCredential(request: AgentRunRequest): string {
  const headers = request.telemetry?.exporters?.otlp?.headers ?? {};
  return (headers.authorization ?? headers.Authorization ?? "").trim();
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

function klog(message: string): void {
  process.stderr.write(`[keepalive] ${message}\n`);
}

/**
 * The engine seam the keep-alive dispatch drives. The default wires to the real engine; tests
 * inject a fake to exercise the pool/dispatch policy without a live harness.
 */
export interface KeepaliveEngine {
  /** Sign the session's durable mount once, up front. Null = no mount = never park. */
  resolveKeepaliveMount(
    request: AgentRunRequest,
  ): Promise<MountCredentials | null>;
  acquireEnvironment(
    request: AgentRunRequest,
    signal: AbortSignal | undefined,
    presignedMount: MountCredentials | null,
  ): Promise<
    { ok: true; env: SessionEnvironment } | { ok: false; error: string }
  >;
  runTurn(
    env: SessionEnvironment,
    request: AgentRunRequest,
    emit: EmitEvent | undefined,
    signal: AbortSignal | undefined,
    opts: RunTurnOptions,
  ): Promise<AgentRunResult>;
  /**
   * Today's cold path (acquire -> runTurn -> teardown). Used when a request must not park.
   * `presignedMount` threads an already-signed mount in (null = signed, no mount — do not sign
   * again; undefined = not signed — acquire signs itself), so the mount is signed exactly once.
   */
  runCold(
    request: AgentRunRequest,
    emit?: EmitEvent,
    signal?: AbortSignal,
    presignedMount?: MountCredentials | null,
  ): Promise<AgentRunResult>;
}

const realKeepaliveEngine: KeepaliveEngine = {
  resolveKeepaliveMount: (request) => resolveKeepaliveMount(request),
  acquireEnvironment: (request, signal, presignedMount) =>
    acquireEnvironment(request, {}, signal, presignedMount),
  runTurn: (env, request, emit, signal, opts) =>
    runTurn(env, request, emit, signal, opts),
  // Same acquire -> runTurn -> destroy composition as `runSandboxAgent`, with the presigned
  // mount threaded through so an up-front keep-alive sign is never repeated.
  runCold: async (request, emit, signal, presignedMount) => {
    const acquired = await acquireEnvironment(
      request,
      {},
      signal,
      presignedMount,
    );
    if (!acquired.ok) return { ok: false, error: acquired.error };
    try {
      return await runTurn(acquired.env, request, emit, signal, {
        loaded: acquired.env.loadedFromContinuity,
      });
    } finally {
      await acquired.env.destroy({
        keepWarm: acquired.env.resumable && !signal?.aborted,
      });
    }
  },
};

/**
 * Whether a completed turn's environment may be parked: never on abort, client disconnect,
 * pause, or failure. Session-owned streams survive disconnect WITHOUT aborting the run signal
 * (server policy), so the disconnect check needs the separate `clientGone` flag.
 */
function shouldPark(
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

export interface KeepaliveContext {
  engine: KeepaliveEngine;
  pool: SessionPool<SessionEnvironment>;
  config: KeepaliveConfig;
  /** Reports a mid-turn client disconnect on the streaming edge (see `RunAgentOptions`). */
  clientGone?: () => boolean;
}

/**
 * True when the request resolves to exactly the `local` provider (the same resolution
 * `buildRunPlan` uses). Keep-alive is local-only, and an unknown/future REMOTE provider must
 * fail closed to cold rather than park, so anything not literally "local" is out.
 */
function isLocalSandbox(request: AgentRunRequest): boolean {
  return resolvesToLocalProvider(request.sandbox);
}

/**
 * Keep-alive dispatch. A pool hit whose fingerprints + credential epoch match and whose tail is
 * a fresh user message continues the live environment (`runTurn` with `continuation`); anything
 * else (miss, mismatch, busy, no mount, remote) evicts as needed and runs today's cold path.
 * A validation failure never fails the turn: it degrades to cold.
 */
export async function runWithKeepalive(
  request: AgentRunRequest,
  emit: EmitEvent | undefined,
  signal: AbortSignal | undefined,
  ctx: KeepaliveContext,
): Promise<AgentRunResult> {
  const { engine, pool, config, clientGone } = ctx;
  const sessionId = request.sessionId?.trim();

  // Track whether anything reached the client on this streaming edge. A live continuation/resume
  // that fails AFTER emitting (a partial answer or an error event) must NOT retry cold: the client
  // and persistence already saw the failed live stream, and a following cold answer would duplicate
  // it. Only a live turn that emitted NOTHING yet may fall back to a fresh cold turn (today's
  // resilience). In buffered mode (`emit` undefined) nothing is ever streamed, so a cold retry is
  // always safe. `emit` stays undefined when undefined so `runTurn` keeps buffering.
  let emitted = false;
  const trackedEmit: EmitEvent | undefined = emit
    ? (event) => {
        emitted = true;
        emit(event);
      }
    : undefined;

  // Eligibility: session-owned + local sandbox. Otherwise never park; run cold as today
  // (no up-front sign happened, so the cold path signs itself: still exactly once).
  if (!sessionId || !isLocalSandbox(request)) {
    return engine.runCold(request, emit, signal);
  }

  // Sign the mount once, up front. The mount's owning project is the only trustworthy project
  // scope; no mount (store unconfigured, 503) or no projectId => no safe pool key => never park,
  // and the sign result — null included — is threaded into the cold path so it never re-signs.
  let signed: MountCredentials | null | undefined;
  try {
    signed = await engine.resolveKeepaliveMount(request);
  } catch {
    signed = undefined; // sign attempt failed outright: let the cold acquire retry it
  }
  const key = poolKeyFor(request, signed?.projectId);
  if (!key) {
    klog(`miss (no mount project scope) session=${sessionId}; cold`);
    return engine.runCold(request, emit, signal, signed);
  }
  const mountCreds = signed!;

  const cfgFp = configFingerprint(request);
  const incomingEpoch = computeCredentialEpoch(request, mountCreds.expiresAt);

  // The fingerprint the NEXT request's prior conversation is expected to hash to; the same
  // one works for an approval park, whose gated tool_call id the FE folds back into the
  // resume request's assistant turn.
  const nextHistoryFp = (env: SessionEnvironment): string =>
    expectedNextHistoryFingerprint(
      request.messages ?? [],
      env.lastTurnToolCallIds ?? [],
    );

  // Whether a paused turn holds a single, parkable permission gate (a Claude ACP gate or a Pi
  // ACP gate). Only such a gate carries a `respondPermission`-answerable id; a client-tool MCP
  // pause never records `parkedApproval`, and more than one pending gate cannot be answered by
  // the single-gate resume — both stay on the cold path, logged.
  const approvalToPark = (
    env: SessionEnvironment,
    result: AgentRunResult,
  ): boolean => {
    if (result.stopReason !== "paused") return false;
    if (!env.parkedApproval) {
      klog(`non-parkable-gate-no-park key=${key}`);
      return false;
    }
    if ((env.approvalGateCount ?? 0) > 1) {
      klog(`multi-gate-no-park key=${key} gates=${env.approvalGateCount}`);
      return false;
    }
    // An approval park waits for the HUMAN, who is still on the page even if the streaming client
    // dropped right after the pause frame. So, unlike a normal park, do NOT consult clientGone or
    // the abort signal here; the approval TTL bounds the wait and an expiry degrades to the cold
    // decision-map path.
    return true;
  };

  // A parked prompt that REJECTS while the session sits in awaiting_approval means the harness
  // or sandbox died mid-park; the dead session must not occupy a pool slot until the approval TTL
  // (5 minutes by default) expires. Identity-checked: the handler evicts only while THIS exact
  // entry is still parked at the key. A rejection that lands after a successful checkout (the
  // resume is in flight and owns the environment; its own try/catch handles the failure) or
  // after a supersede is not ours and does nothing. `evict` is idempotent through the session's
  // one destroy, so no double-destroy is possible. The promise already carries runTurn's
  // swallowing catch, so no unhandled rejection is introduced.
  const watchParkedPrompt = (env: SessionEnvironment): void => {
    const promptPromise = env.parkedApproval?.promptPromise;
    const entry = pool.get(key);
    if (!promptPromise || !entry || entry.environment !== env) return;
    promptPromise.catch(() => {
      const current = pool.get(key);
      if (current !== entry || current.state !== "awaiting_approval") return;
      klog(`parked-prompt-rejected key=${key}; evict`);
      void pool.evict(key, "parked-prompt-rejected");
    });
  };

  // Park a freshly cold-acquired environment (new pool slot) as approval / idle, or tear it down.
  const parkFreshOrDestroy = async (
    env: SessionEnvironment,
    result: AgentRunResult,
  ): Promise<void> => {
    env.clearTurn();
    const input = {
      key,
      environment: env,
      configFingerprint: cfgFp,
      historyFingerprint: nextHistoryFp(env),
      credentialEpoch: incomingEpoch,
      destroy: env.destroy,
    };
    if (approvalToPark(env, result)) {
      klog(
        `park-approval key=${key} tool=${env.parkedApproval?.toolName ?? "?"}`,
      );
      if (
        !(await pool.park(input, config.approvalTtlMs, "awaiting_approval"))
      ) {
        await env.destroy();
      } else {
        watchParkedPrompt(env);
      }
    } else if (shouldPark(result, signal, clientGone)) {
      if (!(await pool.park(input, config.ttlMs))) await env.destroy();
    } else {
      await env.destroy();
    }
  };

  // Re-park a checked-out pool session (same slot) as approval / idle, or evict it.
  const reparkOrEvict = async (
    live: LiveSession<SessionEnvironment>,
    result: AgentRunResult,
  ): Promise<void> => {
    const env = live.environment;
    env.clearTurn();
    const update = {
      configFingerprint: cfgFp,
      historyFingerprint: nextHistoryFp(env),
      credentialEpoch: incomingEpoch,
    };
    if (approvalToPark(env, result)) {
      klog(
        `park-approval key=${key} tool=${env.parkedApproval?.toolName ?? "?"}`,
      );
      if (
        !pool.repark(live, update, config.approvalTtlMs, "awaiting_approval")
      ) {
        await live.destroy();
      } else {
        watchParkedPrompt(env);
      }
    } else if (shouldPark(result, signal, clientGone)) {
      if (!pool.repark(live, update, config.ttlMs)) await live.destroy();
    } else {
      await pool.evictIfCurrent(
        live,
        `no-park:${result.stopReason ?? "failed"}`,
      );
    }
  };

  const coldAndPark = async (): Promise<AgentRunResult> => {
    const acq = await engine.acquireEnvironment(request, signal, mountCreds);
    if (!acq.ok) return { ok: false, error: acq.error };
    const env = acq.env;
    let result: AgentRunResult;
    try {
      // Park mode on: a Claude ACP permission gate this turn keeps the session alive instead of
      // tearing down. A non-parkable pause (Pi relay/builtin, client tool) still destroys as today.
      result = await engine.runTurn(env, request, trackedEmit, signal, {
        approvalParkMode: true,
        loaded: env.loadedFromContinuity,
      });
    } catch (err) {
      await env.destroy();
      return {
        ok: false,
        error: String(err instanceof Error ? err.message : err),
      };
    }
    await parkFreshOrDestroy(env, result);
    return result;
  };

  const existing = pool.get(key);
  if (existing && existing.state === "idle") {
    // Validate the continuation. Any failure evicts and degrades to cold; never fails the turn.
    const priorFp = historyFingerprint(priorConversation(request));
    // Splits the old ambiguous "credentials" reason into credentials-expired (mount lifetime
    // elapsed) vs credentials-rotated (secret/tool-auth material changed) so log diagnosis works.
    const credMismatch = credentialEpochMismatch(
      existing.credentialEpoch,
      incomingEpoch,
    );
    let mismatch: string | undefined;
    if (cfgFp !== existing.configFingerprint) mismatch = "config";
    else if (priorFp !== existing.historyFingerprint) mismatch = "history";
    else if (credMismatch) mismatch = credMismatch;
    else if (!tailIsFreshUserMessage(request)) mismatch = "tail";

    if (mismatch) {
      klog(`mismatch (${mismatch}) key=${key}; evict + cold`);
      // Await: the old teardown unmounts the same durable cwd the cold acquire is about to
      // mount — they must never overlap.
      await pool.evict(key, `mismatch:${mismatch}`);
      return coldAndPark();
    }

    const live = pool.checkoutIdle(key);
    if (live) {
      klog(`hit-continue key=${key}`);
      let result: AgentRunResult;
      try {
        // A continuation can itself raise an approval gate, so it runs in park mode too.
        result = await engine.runTurn(
          live.environment,
          request,
          trackedEmit,
          signal,
          {
            continuation: true,
            approvalParkMode: true,
          },
        );
      } catch (err) {
        // A continuation that throws destroys the session and retries once cold. Identity-checked
        // (a racing turn may have superseded this slot and parked its own session — never clobber
        // it) and awaited (the teardown's unmount must finish before the cold acquire remounts).
        // But NOT if the failed turn already streamed to the client: a cold retry would duplicate.
        live.environment.clearTurn();
        await pool.evictIfCurrent(live, "continuation-threw");
        if (emitted) {
          klog(
            `evict (continuation-threw) key=${key}; already streamed, no retry`,
          );
          return {
            ok: false,
            error: String(err instanceof Error ? err.message : err),
          };
        }
        klog(`evict (continuation-threw) key=${key}; retry cold`);
        void err;
        return coldAndPark();
      }
      if (!result.ok) {
        // A failed continuation may mean a broken live session: destroy and retry once cold
        // (identity-checked + awaited, same as the throw path above). But NOT if the failed turn
        // already streamed to the client: return the failure, a cold retry would duplicate.
        live.environment.clearTurn();
        await pool.evictIfCurrent(live, "continuation-failed");
        if (emitted) {
          klog(
            `evict (continuation-failed) key=${key}; already streamed, no retry`,
          );
          return result;
        }
        klog(`evict (continuation-failed) key=${key}; retry cold`);
        return coldAndPark();
      }
      await reparkOrEvict(live, result);
      return result;
    }
    // checkout lost a race; fall through to cold.
  } else if (existing && existing.state === "awaiting_approval") {
    // An approval-parked session. A validated approval decision that matches the parked
    // Claude ACP gate resumes it live; anything else evicts and degrades to cold.
    //
    // Unlike the idle-continuation branch above, this branch does NOT require the resume request's
    // configFingerprint or credential epoch to EQUAL the parked session's. Every approval reply is
    // a fresh /run the backend mints carrying freshly minted short-lived material (gateway/Composio
    // secret VALUES, a per-turn tool-callback bearer), so the incoming credential epoch — and often
    // the config fingerprint, which can embed those per-turn tokens — practically never match the
    // parked ones. But the parked live process already holds its OWN resolved credentials baked at
    // acquire time; the resume request only delivers the human's yes/no. Re-minted per-turn material
    // on the resume says nothing about the parked environment's validity, so matching it against the
    // park would evict a perfectly good live session on every approval (the "approve twice" bug).
    //
    // We keep the checks that DO bound the parked environment: the approval-decision match, the
    // history fingerprint (an edited transcript must not continue wrongly), and a hard mount-expiry
    // bound — if the parked session's mount credentials are past expiry, its durable cwd can no
    // longer be written, so evict to cold.
    const parked = existing.environment.parkedApproval;
    const decision = parked
      ? approvalDecisionForToolCall(request, parked.toolCallId)
      : undefined;
    const priorFp = historyFingerprint(priorConversation(request));
    let mismatch: string | undefined;
    if (
      !parked ||
      (parked.gateType !== "claude-acp-permission" &&
        parked.gateType !== "pi-acp-permission")
    ) {
      // Defensive: only a parkable gate type (Claude ACP or Pi ACP) ever parks here. Both
      // resume via `respondPermission` on the live session; the daemon maps the reply by kind.
      mismatch = "unrecognized-gate-type";
    } else if (!decision) {
      mismatch = "no-matching-approval"; // fresh user text, or an approval for another id
    } else if (priorFp !== existing.historyFingerprint) {
      mismatch = "history";
    } else if (mountCredentialsExpired(existing.credentialEpoch)) {
      mismatch = "credentials-expired";
    }

    if (mismatch || !parked || !decision) {
      klog(
        `approval-mismatch (${mismatch ?? "unknown"}) key=${key}; evict + cold`,
      );
      await pool.evict(key, `approval-mismatch:${mismatch ?? "unknown"}`);
      return coldAndPark();
    }

    const live = pool.checkoutApproval(key);
    if (live) {
      const reply = decision === "allow" ? "once" : "reject";
      klog(
        `${reply === "once" ? "resume-approve" : "resume-reject"} key=${key} ` +
          `tool=${parked.toolName ?? "?"}`,
      );
      let result: AgentRunResult;
      try {
        // Answer the parked gate on the SAME live session; the original prompt continues and this
        // (new) turn owns streaming + tracing. The gated tool runs with its original byte-exact
        // args — no model re-issues anything, so argument drift/task restart cannot happen.
        result = await engine.runTurn(
          live.environment,
          request,
          trackedEmit,
          signal,
          {
            approvalParkMode: true,
            resume: {
              permissionId: parked.permissionId,
              reply,
              toolCallId: parked.toolCallId,
              toolName: parked.toolName,
              args: parked.args,
              interactionToken: parked.interactionToken,
              promptPromise: parked.promptPromise,
            },
          },
        );
      } catch (err) {
        // As in the continuation branch: retry cold only if nothing streamed to the client yet.
        live.environment.clearTurn();
        await pool.evictIfCurrent(live, "resume-threw");
        if (emitted) {
          klog(`evict (resume-threw) key=${key}; already streamed, no retry`);
          return {
            ok: false,
            error: String(err instanceof Error ? err.message : err),
          };
        }
        klog(`evict (resume-threw) key=${key}; retry cold`);
        void err;
        return coldAndPark();
      }
      if (!result.ok) {
        live.environment.clearTurn();
        await pool.evictIfCurrent(live, "resume-failed");
        if (emitted) {
          klog(`evict (resume-failed) key=${key}; already streamed, no retry`);
          return result;
        }
        klog(`evict (resume-failed) key=${key}; retry cold`);
        return coldAndPark();
      }
      await reparkOrEvict(live, result);
      return result;
    }
    // checkout lost a race; fall through to cold.
  } else if (existing) {
    // Busy / destroyed: two turns racing one session. Only a checkoutIdle continuation leaves a
    // busy entry in the map (checkoutApproval REMOVES its session, so an in-flight approval
    // resume can never be found — a duplicate approval misses the pool and runs cold, and its
    // environment can never be destroyed by this branch). Supersede — destroy the parked one and
    // cold-start — awaited so its teardown cannot overlap our acquire.
    klog(`evict (supersede-${existing.state}) key=${key}; cold`);
    await pool.evict(key, `supersede-${existing.state}`);
  } else {
    klog(`miss key=${key}; cold`);
  }

  return coldAndPark();
}

// One engine: `sandbox-agent` drives a harness (Pi or Claude) over ACP. The harness is
// selected by `request.harness`, not by an engine selector.
//
// The keep-alive pool is a single per-replica singleton, consulted only when the flag is on.
// With the flag off (default) the pool is never touched and the dispatch is byte-identical to
// today (`runSandboxAgent`). `/kill` and shutdown drain it through `destroyAll`.
const keepalivePool = new SessionPool<SessionEnvironment>(
  readKeepaliveConfig(),
);

const runAgent: RunAgent = (request, emit, signal, options) => {
  const config = readKeepaliveConfig();
  if (!config.enabled) return runSandboxAgent(request, emit, signal);
  return runWithKeepalive(request, emit, signal, {
    engine: realKeepaliveEngine,
    pool: keepalivePool,
    config,
    clientGone: options?.clientGone,
  });
};

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

  // Diagnostic: surface whether the session-owned persist/alive path is entered and
  // whether the invoke credential arrived. Empty cred => heartbeat/persist would 401.
  process.stderr.write(
    `[sessions] stream sessionOwned=${sessionOwned} sessionId=${sessionId ?? "-"} turnId=${turnId ?? "-"} cred=${runCredential(request) ? "present" : "MISSING"}\n`,
  );

  // Session-owned runs survive client disconnect — the runner owns the run. Non-session
  // runs abort on disconnect (original behavior: caller drives, disconnect = cancel).
  const controller = new AbortController();
  let clientDisconnected = false;
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

  // For session-owned runs: wrap the live emitter so every event is also persisted
  // producer-side, independent of whether the client is still connected.
  let emitFn: EmitEvent = liveEmit;
  let flushPersist: (() => Promise<void>) | undefined;
  let persistError: ((message: string) => void) | undefined;
  let aliveWatchdog: { release: () => Promise<void> } | undefined;

  if (sessionOwned) {
    // The request's api base (if any) is already scoped for this call via
    // runWithRequestApiBase in the outer runAndStream — apiBase() below sees it.
    // The runner authenticates session calls AS the invoke caller (the run credential),
    // refreshing it for the turn's lifetime — never the admin key. Project scope is
    // resolved server-side from the credential, so no project_id rides the request.
    const watchdog = startAliveWatchdog(
      sessionId,
      turnId,
      runCredential(request),
    );
    aliveWatchdog = watchdog;
    // A new turn supersedes any prior turn's unanswered gate: cancel stale pending
    // interactions (sparing this turn's own). Best-effort, never blocks the turn.
    void cancelStaleInteractions(sessionId, turnId, watchdog.credential);
    const {
      emit: persistingEmit,
      persist,
      flush,
    } = buildPersistingEmitter(sessionId, watchdog.credential, liveEmit);
    // Record the inbound user turn first so the session record is the full conversation,
    // not just agent output. Interaction replies ride tool_result blocks (no text) and are
    // already recorded on the interaction, so an empty prompt persists nothing.
    const promptText = resolvePromptText(request);
    if (promptText) persist({ type: "message", text: promptText }, "user");
    emitFn = persistingEmit;
    flushPersist = flush;
    persistError = (message) => persist({ type: "error", message }, "agent");
  }

  let result: AgentRunResult;
  try {
    result = await run(request, emitFn, controller.signal, {
      clientGone: () => clientDisconnected,
    });
    // A failed engine run ({ok:false}) already emitted its own error EVENT through the
    // persisting emitter, so no extra persist here (it would duplicate the record). Drain
    // all queued persists before the sandbox tears down.
    if (flushPersist) await flushPersist();
  } catch (err) {
    const message =
      err instanceof Error ? (err.stack ?? err.message) : String(err);
    // A throw escaping run() itself (outside the engine's own try/catch) emitted no error
    // event — persist it here as the backstop.
    if (persistError) persistError(message);
    if (flushPersist) await flushPersist().catch(() => {});
    result = { ok: false, error: message };
  } finally {
    if (aliveWatchdog) await aliveWatchdog.release().catch(() => {});
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

/** Build the HTTP request listener around a given engine runner (the testable seam). */
export function createRequestListener(
  run: RunAgent,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res) => {
    try {
      if (req.method === "GET" && req.url === "/health") {
        return send(res, 200, runnerInfo());
      }

      if (req.method === "POST" && req.url === "/kill") {
        if (!isAuthorized(req)) {
          return send(res, 401, { ok: false, error: "Unauthorized" });
        }
        // Idempotent, best-effort: the API collapses the alive lock (the runner's
        // per-run finally then destroys its own sandbox); this endpoint lets the
        // orphan sweeper force a process-wide teardown out-of-band. Drain the keep-alive
        // pool first (its complete per-session destroy), then the sandbox registry as a
        // second line of defense. Always ok.
        await keepalivePool.destroyAll();
        await destroyInFlightSandboxes();
        return send(res, 200, { ok: true });
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
              error: `Invalid JSON: ${String(err)}`,
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
      const message =
        err instanceof Error ? (err.stack ?? err.message) : String(err);
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
      await keepalivePool.destroyAll(timeoutMs);
      await destroyInFlightSandboxes(timeoutMs);
    },
  });

  createAgentServer().listen(PORT, HOST, () => {
    process.stderr.write(
      `[sandbox-agent] http server listening on ${HOST}:${PORT}\n`,
    );
    if (insecureEgressAllowed()) {
      process.stderr.write(
        "[sandbox-agent] WARNING: AGENTA_INSECURE_EGRESS_ALLOWED is set: user MCP servers may " +
          "target http and private/loopback/metadata hosts. Use only for trusted/single-tenant deployments.\n",
      );
    } else {
      process.stderr.write(
        "[sandbox-agent] Outbound egress is in restricted mode: user MCP servers must use https and " +
          "public hosts (private/loopback/link-local/metadata targets are blocked).\n",
      );
    }
  });
}
