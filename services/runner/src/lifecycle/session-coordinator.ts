/**
 * `SessionCoordinator` -- the session decision logic, extracted from `server.ts`.
 *
 * LIFECYCLE MIGRATION, STEP 3. This module is PURE CODE MOTION. The warm gate, the
 * approval-resume path, the miss path, the eviction choice, and the re-parking policy all moved
 * here byte for byte. Nothing about the decisions changed, and the whole keep-alive suite passes
 * unedited. That is the point: an extraction that also changes behavior cannot be reviewed.
 *
 * `server.ts` keeps what a transport owns: HTTP, authentication, request decoding, concurrency,
 * and the watchdog. It calls `runWithKeepalive` and re-exports the seams the tests already
 * import, so no existing import path breaks.
 *
 * WHAT LIVES HERE
 *  - `KeepaliveEngine`: the engine seam. Tests inject a fake to exercise the policy with no live
 *    harness.
 *  - `KeepaliveContext`: the engine, the pool, the config, and the two per-turn accessors.
 *  - `resolveKeepaliveProvider` / `resolveKeepaliveDispatch`: which pool a request routes to.
 *  - `runWithKeepalive`: the decision itself.
 *
 * WHAT DOES NOT LIVE HERE
 *  - `realKeepaliveEngine`, the binding to the live engine. The coordinator must not import the
 *    engine implementation, or the seam it exists to provide would be pointless. `server.ts`
 *    wires it.
 *
 * STEP 4 SITS BESIDE THIS FILE. The reconciliation router builds a plan and LOGS it. The decision
 * below still rules. See `reconciliation-router.ts`.
 */
import { randomUUID } from "node:crypto";

import type {
  AgentRunRequest,
  AgentRunResult,
  EmitEvent,
} from "../protocol.ts";
import {
  shouldPark,
  type ParkedApproval,
  type ResumeApprovalInput,
  type RunTurnOptions,
  type SessionEnvironment,
} from "../engines/sandbox_agent.ts";
import type { MountCredentials } from "../engines/sandbox_agent/mount.ts";
import type { TeardownReason } from "../engines/sandbox_agent/teardown.ts";
import {
  daytonaCredentialCapabilities,
  localCredentialCapabilities,
  mechanismForRotation,
} from "../providers/credential-delivery-port.ts";
import {
  approvalDecisionForToolCall,
  assertsPriorConversation,
  computeCredentialEpoch,
  configFingerprint,
  credentialEpochMismatch,
  carriesApprovalReplyOnly,
  carriesMinimalHistory,
  installedMountLease,
  leaseExpiresBy,
  mountCredentialsExpired,
  mountCredentialsExpireBy,
  MOUNT_LEASE_SKEW_MS,
  sandboxCredentialsRotated,
  type CredentialEpoch,
  type CredentialMaterial,
  expectedNextHistoryFingerprint,
  historyFingerprint,
  historyTailFromLastUserTurn,
  poolKeyFor,
  priorConversation,
  resolvesToLocalProvider,
  tailIsFreshUserMessage,
  type KeepaliveConfig,
  type KeepaliveProviderName,
} from "../engines/sandbox_agent/session-identity.ts";
import {
  SessionPool,
  type LiveSession,
} from "../engines/sandbox_agent/session-pool.ts";
import { loadRunnerConfig } from "../config/runner-config.ts";
import {
  resolveRunLimits,
  TOTAL_DEADLINE_ENV,
} from "../engines/sandbox_agent/run-limits.ts";
import {
  isLivelyApplicable,
  logReconcileShadow,
  planReconcile,
  type DecisionScope,
} from "./reconciliation-router.ts";
import { normalizeDesiredState } from "./desired-state.ts";
import { formatPlan, type ReconcilePlan } from "./reconcile-plan.ts";

export function klog(message: string): void {
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
  /**
   * `presignedMount` follows the same convention as `runCold`: a value threads the up-front
   * sign in, null = signed with no mount (do not re-sign, run mount-less), undefined = the
   * up-front sign attempt threw (the acquire retries the sign itself).
   */
  acquireEnvironment(
    request: AgentRunRequest,
    signal: AbortSignal | undefined,
    presignedMount: MountCredentials | null | undefined,
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
  /** Best-effort provider activity refresh after a live park succeeds. */
  onParkedLive?(env: SessionEnvironment): Promise<void>;
  /**
   * Apply a reconciliation plan to a LIVE environment (lifecycle migration, step 6).
   *
   * Returns whether the WHOLE plan applied. The implementation must commit applied state only
   * after every action succeeded, and must leave applied state untouched otherwise — a partially
   * applied environment that claims the new configuration is the stale-config bug wearing a
   * different hat.
   *
   * Optional: an engine that does not implement it simply never takes a live route, and every
   * config change keeps rebuilding exactly as before.
   */
  applyReconcilePlan?(
    env: SessionEnvironment,
    request: AgentRunRequest,
    plan: ReconcilePlan,
  ): Promise<boolean>;
  /**
   * Today's cold path (acquire -> runTurn -> teardown). Used when a request must not park.
   * `presignedMount` threads an already-signed mount in (null = signed, no mount — do not sign
   * again; undefined = not signed — acquire signs itself), so the mount is signed exactly once.
   * `clientGone` feeds the same `shouldPark` policy the warm path uses: a remote sandbox is
   * parked to warm only on a completed turn.
   */
  runCold(
    request: AgentRunRequest,
    emit?: EmitEvent,
    signal?: AbortSignal,
    presignedMount?: MountCredentials | null,
    clientGone?: () => boolean,
    credential?: () => string,
  ): Promise<AgentRunResult>;
}

export interface KeepaliveContext {
  engine: KeepaliveEngine;
  pool: SessionPool<SessionEnvironment>;
  config: KeepaliveConfig;
  /** Reports a mid-turn client disconnect on the streaming edge (see `RunAgentOptions`). */
  clientGone?: () => boolean;
  /** Latest session credential accessor supplied by the alive watchdog. */
  credential?: () => string;
}

/**
 * The keep-alive provider this request resolves to (the same resolution `buildRunPlan`
 * uses): "local", "daytona", or undefined for anything else. An unknown or future provider
 * must fail closed to cold rather than park, so only the two known names route to a pool.
 */
export function resolveKeepaliveProvider(
  request: AgentRunRequest,
): KeepaliveProviderName | undefined {
  if (resolvesToLocalProvider(request.sandbox)) return "local";
  const provider = request.sandbox ?? loadRunnerConfig().providers.default;
  return provider === "daytona" ? "daytona" : undefined;
}

export function resolveKeepaliveDispatch(
  request: AgentRunRequest,
  configs: Record<KeepaliveProviderName, KeepaliveConfig>,
): KeepaliveProviderName | undefined {
  const provider = resolveKeepaliveProvider(request);
  return provider && configs[provider].enabled ? provider : undefined;
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
  const { engine, pool, config, clientGone, credential } = ctx;
  const turnCredential = credential ? { credential } : {};
  const sessionId = request.sessionId?.trim();
  // Every execution carries an id: callers that omit `turnId` get one minted here, so the
  // turns-ledger append and interaction rows are never written without their execution id.
  request.turnId = request.turnId?.trim() || randomUUID();

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

  // Eligibility: session-owned. Provider eligibility is resolved before this dispatch. Otherwise
  // never park; run cold as today
  // (no up-front sign happened, so the cold path signs itself: still exactly once).
  if (!sessionId) {
    return engine.runCold(
      request,
      emit,
      signal,
      undefined,
      clientGone,
      credential,
    );
  }

  // Sign the mount once, up front. The mount's owning project is the FALLBACK project scope; the
  // preferred scope is the service-stamped `runContext.project.id` (see `poolKeyFor`). No scope
  // from either source => no safe pool key => never park, and the sign result — null included — is
  // threaded into the cold path so it never re-signs.
  let signed: MountCredentials | null | undefined;
  try {
    signed = await engine.resolveKeepaliveMount(request);
  } catch {
    signed = undefined; // sign attempt failed outright: let the cold acquire retry it
  }
  const scope = poolKeyFor(request, signed?.projectId);
  if (!scope) {
    klog(`miss (no project scope) session=${sessionId}; cold`);
    return engine.runCold(
      request,
      emit,
      signal,
      signed,
      clientGone,
      credential,
    );
  }
  const key = scope.key;
  klog(`scope=${scope.source} key=${key} session=${sessionId}`);

  // The mount may be null here (store unconfigured, 503, ephemeral fallback) or undefined (the
  // sign attempt threw) when the run-context scope produced the key. A mount-less session still
  // parks: the epoch simply carries no mount expiry, and the acquire receives `signed` verbatim
  // (null = do not re-sign; undefined = the acquire retries the sign itself). Never dereference
  // the mount unconditionally past this point — a keep-alive gap may only ever cost a cold
  // restart, never a failed turn.
  const cfgFp = configFingerprint(request);
  const incomingEpoch = computeCredentialEpoch(request);
  // Resolved once per dispatch: the longest a turn started now could still be running.
  const turnBudgetMs = resolveRunLimits().totalMs;
  const requiredValidThroughMs =
    Date.now() + turnBudgetMs + MOUNT_LEASE_SKEW_MS;

  // The fingerprint the NEXT request's prior conversation is expected to hash to; the same
  // one works for an approval park, whose gated tool_call id the FE folds back into the
  // resume request's assistant turn.
  const nextHistoryFp = (env: SessionEnvironment): string =>
    expectedNextHistoryFingerprint(
      request.messages ?? [],
      env.lastTurnToolCallIds ?? [],
    );

  // A park can only assert what its request carried: a last-message-only turn hashes ONE user
  // turn, so its fingerprint must not later be compared against a full transcript.
  const historyAsserted = assertsPriorConversation(request);

  /**
   * SHADOW ROUTING (lifecycle migration, step 4). Build the reconciliation plan for this dispatch
   * and log it beside the decision that was actually taken. The plan decides NOTHING here.
   *
   * This is Terraform's plan without apply. The router is pure, so calling it cannot change or
   * fail the turn; the only product is a log line, and a `DISAGREE` marker is the signal that the
   * router's facet ownership still needs work before step 5 lets it decide anything.
   */
  /**
   * LIFECYCLE MIGRATION, STEP 6. Try to satisfy a configuration change on the RUNNING
   * environment instead of rebuilding it.
   *
   * This is the first genuine behavior change in the lifecycle work, so every guard matters:
   *
   *  - It runs ONLY for `mismatch:config`. The credential and continuity mismatches are decided
   *    before this point by their own checks and are untouched — credential facets keep
   *    delegating to the epoch comparison until step 8 teaches the router to read it.
   *  - The plan must be ENTIRELY live-applicable. A mixed plan rebuilds, because applying half
   *    of it would leave the environment in a state no request ever described.
   *  - The engine commits applied state only after every action succeeded. A `false` return
   *    leaves the environment exactly as it was.
   *  - Any throw is caught and treated as "did not apply". FAIL CLOSED: an unexpected failure
   *    must cost a rebuild, never a silently half-reconfigured environment.
   */
  const tryLiveRoutes = async (
    existing: LiveSession<SessionEnvironment>,
  ): Promise<ReconcilePlan | undefined> => {
    if (!engine.applyReconcilePlan) return undefined;
    const desired = normalizeDesiredState(request, cfgFp);
    const plan = planReconcile(
      request,
      desired,
      existing.environment.appliedState.facets,
    );
    if (plan.actions.length === 0) return undefined;
    if (!isLivelyApplicable(plan)) return undefined;
    try {
      const applied = await engine.applyReconcilePlan(
        existing.environment,
        request,
        plan,
      );
      if (applied) {
        klog(
          `live-route key=${key} applied=[${formatPlan(plan)}] ` +
            `generation=${existing.environment.appliedState.generation}`,
        );
        return plan;
      }
      klog(`live-route key=${key} refused=[${formatPlan(plan)}]; rebuilding`);
      return undefined;
    } catch (err) {
      klog(
        `live-route key=${key} threw, rebuilding: ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
      return undefined;
    }
  };

  /**
   * The credential-delivery capabilities of the provider this dispatch will use.
   *
   * STEP 8. Which action a rotation needs is PROVIDER-DEPENDENT, so the router cannot decide it:
   * `local` bakes values into a daemon environment that is frozen before the daemon starts, while
   * Daytona holds an opaque reference whose value the provider substitutes at egress. These values
   * carry the security review's RULING B — Daytona declares its egress propagation unbounded,
   * which makes the live rotation route ineligible and a rotation a rebuild.
   */
  const credentialCapabilities =
    resolveKeepaliveProvider(request) === "daytona"
      ? daytonaCredentialCapabilities
      : localCredentialCapabilities;

  const shadowRoute = (
    existing: LiveSession<SessionEnvironment> | undefined,
    decision: "reuse" | "rebuild",
    decisionReason: string,
    scope: DecisionScope = "environment",
    plan?: ReconcilePlan,
    rotated = false,
  ): void => {
    logReconcileShadow({
      key,
      request,
      configFingerprint: cfgFp,
      appliedFingerprint: existing?.environment.appliedState.configFingerprint,
      appliedDigests: existing?.environment.appliedState.facets,
      decision,
      decisionReason,
      scope,
      ...(plan ? { plan } : {}),
      credential: {
        mechanism: rotated
          ? mechanismForRotation(credentialCapabilities)
          : undefined,
      },
    });
  };

  const resultTeardownReason = (result: AgentRunResult): TeardownReason =>
    shouldPark(result, signal, clientGone)
      ? "clean-resumable"
      : signal?.aborted || clientGone?.()
        ? "aborted"
        : "failed-turn";

  /**
   * Turn a dispatch mismatch label into the teardown reason that names the FAILING LAYER.
   *
   * LIFECYCLE MIGRATION, STEP 1. Every mismatch used to tear down with one
   * `compatibility-mismatch` reason, so every mismatch deleted the sandbox. The mapping below
   * says which layer is actually wrong, and `teardownDisposition` then parks only the layers
   * whose daemon is still sound.
   *
   * The mapping is conservative on purpose. Anything that might have baked material into the
   * DAEMON maps to `runtime-incompatible`, which deletes. Only a wrong CONVERSATION or a wrong
   * harness SESSION parks, because neither says anything is stale inside the sandbox.
   */
  const mismatchTeardownReason = (mismatch: string): TeardownReason => {
    // A conversation problem. The environment is fine; the transcript is not.
    if (mismatch === "history" || mismatch === "tail") return "continuity-invalid";
    // Credentials live in the daemon's environment on Daytona, and Pi's runtime assets are
    // installed at start. A parked sandbox would resume with the stale material still in place,
    // so these must delete. This is the case the lifecycle design warns about by name.
    if (mismatch.startsWith("credentials")) return "runtime-incompatible";
    // A parked approval gate the runner can no longer answer. Nothing inside the sandbox is
    // stale, so the sandbox may park.
    if (mismatch === "no-parked-gate" || mismatch === "unrecognized-gate-type")
      return "session-incompatible";
    // `config` covers every remaining configuration change, including a changed model connection
    // or MCP credential shape. Until the reconciliation router can say which facet moved, treat
    // it as runtime-level and delete. Delete is always sound; it only costs a rebuild.
    return "runtime-incompatible";
  };

  const notifyParkedLive = async (env: SessionEnvironment): Promise<void> => {
    if (resolveKeepaliveProvider(request) !== "daytona") return;
    // Best-effort: the session is already parked, so an activity-refresh failure must not turn
    // a successful turn into a failed request.
    try {
      await engine.onParkedLive?.(env);
    } catch (err) {
      klog(
        `parked-live activity refresh failed key=${key}: ${String(
          err instanceof Error ? err.message : err,
        ).slice(0, 200)}`,
      );
    }
  };

  // Whether a paused turn is fully parkable: every pending gate is a parkable ACP permission gate
  // (Claude, Codex, or Pi ACP) that carries a `respondPermission`-answerable id, so the warm
  // resume can answer them all. A turn parks when it has at least one parked gate AND every
  // pending gate is parkable: no client-tool MCP pause (unanswerable across a turn boundary), and
  // no approval gate that lacked a resumable id. A mixed or partly-unresumable set stays on the
  // cold path, which is the only path that can multiplex it. Any count of parkable gates parks —
  // a turn with several parallel gates is answered by several `respondPermission` calls on the
  // resume.
  const approvalToPark = (
    env: SessionEnvironment,
    result: AgentRunResult,
  ): boolean => {
    if (result.stopReason !== "paused") return false;
    if (env.parkedApprovals.size === 0) {
      klog(`non-parkable-gate-no-park key=${key}`);
      return false;
    }
    if ((env.nonParkablePauseCount ?? 0) > 0) {
      klog(
        `mixed-gate-no-park key=${key} parkable=${env.parkedApprovals.size} ` +
          `nonParkable=${env.nonParkablePauseCount}`,
      );
      return false;
    }
    if (env.parkedApprovals.size !== (env.approvalGateCount ?? 0)) {
      klog(
        `unresumable-gate-no-park key=${key} parkable=${env.parkedApprovals.size} ` +
          `gates=${env.approvalGateCount}`,
      );
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
    const entry = pool.get(key);
    if (!entry || entry.environment !== env) return;
    // Watch the WHOLE parked set: a turn is pending until every gate resolves, so a rejection of
    // ANY parked prompt means the harness or sandbox died mid-park and the dead session must be
    // evicted. Every parked gate shares the one turn prompt promise, so the catches are on the
    // same promise; the eviction is identity-checked and idempotent, so repeated catches are safe.
    for (const parked of env.parkedApprovals.values()) {
      const promptPromise = parked.promptPromise;
      if (!promptPromise) continue;
      promptPromise.catch(() => {
        const current = pool.get(key);
        if (current !== entry || current.state !== "awaiting_approval") return;
        klog(`parked-prompt-rejected key=${key}; evict`);
        void pool.evict(key, "parked-prompt-rejected", "failed-turn");
      });
    }
  };

  // A parked epoch's expiry comes from the credentials installed in the environment's mounts, not
  // from whatever this dispatch signed to compute the pool key.
  const parkedEpoch = (
    env: SessionEnvironment,
    secrets: CredentialMaterial,
  ): CredentialEpoch => ({
    secrets,
    mountExpiresAtMs: installedMountLease(env.installedMountExpiries),
  });

  // Park a freshly cold-acquired environment (new pool slot) as approval / idle, or tear it down.
  const parkFreshOrDestroy = async (
    env: SessionEnvironment,
    result: AgentRunResult,
  ): Promise<void> => {
    env.clearTurn();
    const input = {
      key,
      environment: env,
      // No `configFingerprint`. The environment owns it (lifecycle migration, step 2).
      historyFingerprint: nextHistoryFp(env),
      historyAsserted,
      credentialEpoch: parkedEpoch(env, incomingEpoch.secrets),
      teardown: (reason: TeardownReason) => env.destroy({ reason }),
    };
    if (approvalToPark(env, result)) {
      klog(
        `park-approval key=${key} tool=${env.parkedApproval?.toolName ?? "?"}`,
      );
      if (
        !(await pool.park(input, config.approvalTtlMs, "awaiting_approval"))
      ) {
        await env.destroy({ reason: "failed-turn" });
      } else {
        await notifyParkedLive(env);
        watchParkedPrompt(env);
      }
    } else if (shouldPark(result, signal, clientGone)) {
      if (!(await pool.park(input, config.ttlMs))) {
        await env.destroy({ reason: "clean-resumable" });
      } else {
        await notifyParkedLive(env);
      }
    } else {
      await env.destroy({ reason: resultTeardownReason(result) });
    }
  };

  // Re-park a checked-out pool session (same slot) as approval / idle, or evict it. A re-park
  // describes the LIVE environment, so it always keeps the live secrets hash: on the idle path the
  // mismatch gate already proved the live and incoming hashes equal, and the approval-resume path
  // deliberately keeps the live one (the resume's re-minted secrets were never baked in).
  const reparkOrEvict = async (
    live: LiveSession<SessionEnvironment>,
    result: AgentRunResult,
  ): Promise<void> => {
    const env = live.environment;
    env.clearTurn();
    const update = {
      // No `configFingerprint`. THIS is where the stale-config bug lived: the approval-resume
      // path reached here with the INCOMING request's fingerprint and stamped it onto an
      // environment that had never applied it. The field is gone, so the bug cannot be written.
      historyFingerprint: nextHistoryFp(env),
      historyAsserted,
      credentialEpoch: parkedEpoch(env, live.credentialEpoch.secrets),
    };
    if (approvalToPark(env, result)) {
      klog(
        `park-approval key=${key} tool=${env.parkedApproval?.toolName ?? "?"}`,
      );
      if (
        !(await pool.repark(
          live,
          update,
          config.approvalTtlMs,
          "awaiting_approval",
        ))
      ) {
        await live.teardown("failed-turn");
      } else {
        await notifyParkedLive(env);
        watchParkedPrompt(env);
      }
    } else if (shouldPark(result, signal, clientGone)) {
      if (!(await pool.repark(live, update, config.ttlMs))) {
        await live.teardown("failed-turn");
      } else {
        await notifyParkedLive(env);
      }
    } else {
      await pool.evictIfCurrent(
        live,
        `no-park:${result.stopReason ?? "failed"}`,
        resultTeardownReason(result),
      );
    }
  };

  const coldAndPark = async (): Promise<AgentRunResult> => {
    const acq = await engine.acquireEnvironment(request, signal, signed);
    if (!acq.ok) return { ok: false, error: acq.error };
    const env = acq.env;
    const leaseMs = installedMountLease(env.installedMountExpiries);
    if (leaseExpiresBy(leaseMs, requiredValidThroughMs)) {
      // A misconfigured TTL must never fail a turn: warn once per acquisition and run it.
      klog(
        `lease-short key=${key} leaseExpiresAtMs=${leaseMs} ` +
          `requiredValidThroughMs=${requiredValidThroughMs} ` +
          `(AGENTA_MOUNTS_CREDENTIALS_TTL_SECONDS on the API vs ` +
          `${TOTAL_DEADLINE_ENV}=${turnBudgetMs}ms + skew ${MOUNT_LEASE_SKEW_MS}ms); ` +
          `running anyway, every dispatch will rebuild cold`,
      );
    }
    let result: AgentRunResult;
    try {
      // Park mode keeps a parkable ACP permission gate alive. A non-parkable relay or client-tool
      // pause still destroys the session.
      result = await engine.runTurn(env, request, trackedEmit, signal, {
        approvalParkMode: true,
        loaded: env.loadedFromContinuity,
        ...turnCredential,
      });
    } catch (err) {
      await env.destroy({ reason: "failed-turn" });
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
    // A last-message-only client sends no prior conversation, so there is nothing to compare:
    // `priorConversation` is empty and the fingerprint can never match what the last turn stored.
    // Comparing anyway evicts the warm session on every turn of every conversation. The session
    // id already binds the request to this conversation; the client simply no longer asserts it.
    const clientAssertsHistory = !carriesMinimalHistory(request);
    let mismatch: string | undefined;
    if (cfgFp !== existing.configFingerprint) mismatch = "config";
    else if (clientAssertsHistory && priorFp !== existing.historyFingerprint)
      mismatch = "history";
    else if (credMismatch) mismatch = credMismatch;
    else if (
      // Still-valid credentials that cannot cover a worst-case turn are expiring, not expired:
      // rebuild at the boundary rather than let the turn die under the mount.
      mountCredentialsExpireBy(existing.credentialEpoch, requiredValidThroughMs)
    )
      mismatch = "credentials-expiring";
    else if (!tailIsFreshUserMessage(request)) mismatch = "tail";

    // STEP 6. A pure configuration mismatch gets one chance to be satisfied on the live
    // environment. Everything else — credentials, continuity, an expiring lease — is decided
    // above and never reaches this door.
    if (mismatch === "config") {
      // Pass the plan we ACTED ON: the apply has already committed the new applied state, so
      // recomputing here would yield an empty plan and the counter could not name the route.
      const appliedPlan = await tryLiveRoutes(existing);
      if (appliedPlan) {
        shadowRoute(existing, "reuse", "live-route", "environment", appliedPlan);
        mismatch = undefined;
      }
    }

    if (mismatch) {
      klog(`mismatch (${mismatch}) key=${key}; evict + cold`);
      // A transcript mismatch is a decision about the CONVERSATION, not the environment, so it
      // is logged but never counted against the router. See `DecisionScope`.
      shadowRoute(
        existing,
        "rebuild",
        `mismatch:${mismatch}`,
        mismatch === "history" || mismatch === "tail"
          ? "continuity"
          : "environment",
        undefined,
        // STEP 8. Tell the router what the epoch comparison already knows. `credentials-expiring`
        // and `credentials-expired` are MOUNT LEASE facts, not rotations — the mount subsystem
        // repairs those by re-signing — so only a true rotation feeds the credential input.
        mismatch === "credentials-rotated",
      );
      // Await: the old teardown unmounts the same durable cwd the cold acquire is about to
      // mount — they must never overlap.
      await pool.evict(
        key,
        `mismatch:${mismatch}`,
        mismatchTeardownReason(mismatch),
      );
      return coldAndPark();
    }

    const live = pool.checkoutIdle(key);
    if (live) {
      klog(`hit-continue key=${key}`);
      shadowRoute(existing, "reuse", "hit-continue");
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
            ...turnCredential,
          },
        );
      } catch (err) {
        // A continuation that throws destroys the session and retries once cold. Identity-checked
        // (a racing turn may have superseded this slot and parked its own session — never clobber
        // it) and awaited (the teardown's unmount must finish before the cold acquire remounts).
        // But NOT if the failed turn already streamed to the client: a cold retry would duplicate.
        live.environment.clearTurn();
        await pool.evictIfCurrent(live, "continuation-threw", "failed-turn");
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
        await pool.evictIfCurrent(live, "continuation-failed", "failed-turn");
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
    // ACP gate resumes it live; anything else evicts and degrades to cold.
    //
    // Approval replies may carry re-minted per-turn callback authorization, which does not invalidate
    // the parked process. Credentials baked into the model/MCP environment are different: rotation
    // must evict and cold-start so the resumed process never keeps stale credential material.
    //
    // We keep the checks that DO bound the parked environment: the approval-decision match, the
    // history fingerprint (an edited transcript must not continue wrongly, but only for a client
    // that asserts a transcript at all — see `clientAssertsHistory` below), and a hard mount-expiry
    // bound — if the parked session's mount credentials are past expiry, its durable cwd can no
    // longer be written, so evict to cold.
    // Split parallel parked gates by tool-call id. Any non-empty answer set resumes live; untouched
    // gates stay pending in the same process and are carried into the next approval park.
    const parked = existing.environment.parkedApproval;
    const parkedList = [...existing.environment.parkedApprovals.values()];
    const resumeDecisions: ResumeApprovalInput[] = [];
    const carriedForward: ParkedApproval[] = [];
    let mismatch: string | undefined;
    if (parkedList.length === 0) {
      mismatch = "no-parked-gate";
    } else {
      for (const gate of parkedList) {
        if (
          gate.gateType !== "claude-acp-permission" &&
          gate.gateType !== "codex-acp-permission" &&
          gate.gateType !== "pi-acp-permission"
        ) {
          // Defensive: only a parkable ACP gate type ever parks here. All resume through
          // `respondPermission` on the live session; the daemon maps the reply by kind.
          mismatch = "unrecognized-gate-type";
          break;
        }
        const decision = approvalDecisionForToolCall(request, gate.toolCallId);
        if (!decision) {
          carriedForward.push(gate);
          continue;
        }
        resumeDecisions.push({
          permissionId: gate.permissionId,
          reply: decision === "allow" ? "once" : "reject",
          toolCallId: gate.toolCallId,
          toolName: gate.toolName,
          args: gate.args,
          interactionToken: gate.interactionToken,
          promptPromise: gate.promptPromise,
        });
      }
    }
    const incomingPrior = priorConversation(request);
    // A park that asserted a full transcript is checked against the whole incoming one; a park
    // that only ever saw its own trailing user turn is checked against that turn's slice of it,
    // which still catches an edited tail (text, attachment ids, or tool-call ids).
    const priorFp = historyFingerprint(
      existing.historyAsserted
        ? incomingPrior
        : historyTailFromLastUserTurn(incomingPrior),
    );
    // An out-of-band answer (an inbox, a webhook, a CLI) builds its reply from the durable
    // interaction row and carries no conversation at all, so its prior fingerprint can never equal
    // the parked one and comparing it would evict the very session that could resume — the
    // idle branch's `clientAssertsHistory` escape hatch, which this branch lacked. It cannot reuse
    // `carriesMinimalHistory`: that helper wants a fresh user tail, and an approval reply is never
    // one. The parked gate's tool-call id, matched above, is what binds this answer to this
    // session; the history check only guards a client that DID assert a transcript.
    const clientAssertsHistory = !carriesApprovalReplyOnly(request);
    if (!mismatch) {
      if (clientAssertsHistory && priorFp !== existing.historyFingerprint) {
        mismatch = "history";
      } else if (mountCredentialsExpired(existing.credentialEpoch)) {
        mismatch = "credentials-expired";
      } else if (
        mountCredentialsExpireBy(
          existing.credentialEpoch,
          requiredValidThroughMs,
        )
      ) {
        mismatch = "credentials-expiring";
      } else if (
        sandboxCredentialsRotated(existing.credentialEpoch, incomingEpoch)
      ) {
        // Re-minted per-turn callback auth never invalidates the parked process, but credentials
        // BAKED into the model/MCP environment are different: rotation must evict and cold-start
        // so the resumed process never keeps stale credential material.
        mismatch = "credentials-rotated";
      }
    }

    if (mismatch || resumeDecisions.length === 0) {
      klog(
        `approval-mismatch (${mismatch ?? "unknown"}) key=${key}; evict + cold`,
      );
      shadowRoute(
        existing,
        "rebuild",
        `approval-mismatch:${mismatch ?? "unknown"}`,
        "environment",
        undefined,
        mismatch === "credentials-rotated",
      );
      await pool.evict(
        key,
        `approval-mismatch:${mismatch ?? "unknown"}`,
        // An unanswered approval with no recorded mismatch is a session-level problem: the
        // request carried no decision this parked gate could consume.
        mismatchTeardownReason(mismatch ?? "no-parked-gate"),
      );
      return coldAndPark();
    }

    const live = pool.checkoutApproval(key);
    if (live) {
      shadowRoute(existing, "reuse", "approval-resume");
      const approveCount = resumeDecisions.filter(
        (d) => d.reply === "once",
      ).length;
      const rejectCount = resumeDecisions.length - approveCount;
      klog(
        `resume key=${key} gates=${parkedList.length} answered=${resumeDecisions.length} ` +
          `carried=${carriedForward.length} ` +
          `approve=${approveCount} reject=${rejectCount} tool=${parked?.toolName ?? "?"}`,
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
            resume: { decisions: resumeDecisions, carriedForward },
            ...turnCredential,
          },
        );
      } catch (err) {
        // As in the continuation branch: retry cold only if nothing streamed to the client yet.
        live.environment.clearTurn();
        await pool.evictIfCurrent(live, "resume-threw", "failed-turn");
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
        await pool.evictIfCurrent(live, "resume-failed", "failed-turn");
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
    await pool.evict(key, `supersede-${existing.state}`, "failed-turn");
  } else {
    klog(`miss key=${key}; cold`);
    shadowRoute(undefined, "rebuild", "miss");
  }

  return coldAndPark();
}
