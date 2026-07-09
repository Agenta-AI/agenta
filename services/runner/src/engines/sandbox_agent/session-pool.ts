/**
 * Session keep-alive pool (slice 1: normal turn boundaries, local sandbox, flag-gated off).
 *
 * Background: today the runner destroys the sandbox and harness session at the end of every
 * turn (`sandbox_agent.ts` teardown). Keep-alive parks a live session for a short TTL so the
 * next message in the same conversation continues the same live harness process, keeping its
 * native memory. If the window expires or anything mismatches, the dispatch falls back to
 * today's cold path. Nothing gets worse than today; with the flag off nothing here runs.
 *
 * This module is engine-agnostic: it holds opaque `environment` handles plus the metadata the
 * dispatch needs to decide continue-versus-cold (two fingerprints, a credential epoch, an LRU
 * timestamp, a state) and a complete idempotent `destroy()` closure the engine supplies. It
 * never imports the engine, so it stays a pure map + timer + policy unit.
 *
 * See docs/design/agent-workflows/projects/session-keepalive/plan.md.
 */
import { createHash } from "node:crypto";

import {
  type AgentRunRequest,
  type ChatMessage,
  type ContentBlock,
  messageText,
} from "../../protocol.ts";
import { approvalDecisionOf } from "../../responder.ts";

function log(message: string): void {
  process.stderr.write(`[keepalive] ${message}\n`);
}

// --- Config (read once, in one place; mirrors server.ts's env reads) --------- //

export interface KeepaliveConfig {
  enabled: boolean;
  ttlMs: number;
  approvalTtlMs: number;
  poolMax: number;
}

const KEEPALIVE_ENV = "AGENTA_RUNNER_SESSION_KEEPALIVE";
const TTL_ENV = "AGENTA_RUNNER_SESSION_TTL_MS";
const APPROVAL_TTL_ENV = "AGENTA_RUNNER_SESSION_APPROVAL_TTL_MS";
const POOL_MAX_ENV = "AGENTA_RUNNER_SESSION_POOL_MAX";

const DEFAULT_TTL_MS = 60_000;
const DEFAULT_APPROVAL_TTL_MS = 300_000;
const DEFAULT_POOL_MAX = 8;

function positiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

/** The runner treats only a few explicit truthy spellings as on; default OFF. */
function boolEnv(name: string): boolean {
  const raw = (process.env[name] ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

/** Read the keep-alive config from the environment. One place; the dispatch calls it per run. */
export function readKeepaliveConfig(): KeepaliveConfig {
  return {
    enabled: boolEnv(KEEPALIVE_ENV),
    ttlMs: positiveIntEnv(TTL_ENV, DEFAULT_TTL_MS),
    approvalTtlMs: positiveIntEnv(APPROVAL_TTL_ENV, DEFAULT_APPROVAL_TTL_MS),
    poolMax: positiveIntEnv(POOL_MAX_ENV, DEFAULT_POOL_MAX),
  };
}

// --- Fingerprints and the pool key ------------------------------------------ //

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Deterministic JSON: object keys sorted recursively so equal values hash equal. */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries
    .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`)
    .join(",")}}`;
}

/**
 * A canonical hash over the config-bearing request fields (architecture-notes "Continuation
 * versus cold decision"). Per-turn volatiles are excluded: `messages`, `turnId`, trace
 * propagation (`context`), the rotating telemetry headers, and secret VALUES (`secrets` — the
 * credential epoch covers rotation, and values must never enter any hash used for logging). The
 * tool-callback ENDPOINT is included (routing config); its authorization is a credential and
 * lives in the credential epoch instead.
 */
export function configFingerprint(request: AgentRunRequest): string {
  const workflow = request.runContext?.workflow;
  const shape = {
    harness: request.harness ?? null,
    sandbox: request.sandbox ?? null,
    model: request.model ?? null,
    provider: request.provider ?? null,
    connection: request.connection ?? null,
    deployment: request.deployment ?? null,
    endpoint: request.endpoint ?? null,
    credentialMode: request.credentialMode ?? null,
    agentsMd: request.agentsMd ?? null,
    systemPrompt: request.systemPrompt ?? null,
    appendSystemPrompt: request.appendSystemPrompt ?? null,
    tools: request.tools ?? null,
    skills: request.skills ?? null,
    customTools: request.customTools ?? null,
    mcpServers: request.mcpServers ?? null,
    toolCallbackEndpoint: request.toolCallback?.endpoint ?? null,
    permissions: request.permissions ?? null,
    sandboxPermission: request.sandboxPermission ?? null,
    harnessFiles: request.harnessFiles ?? null,
    workflowRevision: workflow?.revision
      ? {
          id: workflow.revision.id ?? null,
          version: workflow.revision.version ?? null,
        }
      : null,
    isDraft: workflow?.is_draft ?? null,
  };
  return sha256(canonicalJson(shape));
}

function collectToolCallIds(
  content: string | ContentBlock[] | undefined,
  into: string[],
  seen: Set<string>,
): void {
  if (!Array.isArray(content)) return;
  for (const block of content) {
    if (!block) continue;
    if (
      (block.type === "tool_call" || block.type === "tool_result") &&
      typeof block.toolCallId === "string" &&
      block.toolCallId &&
      !seen.has(block.toolCallId)
    ) {
      seen.add(block.toolCallId);
      into.push(block.toolCallId);
    }
  }
}

/**
 * A hash over the conversation the server received (the FE's pruned array): the ordered user
 * message texts, the ordered tool-call ids across every message, and the user-message count.
 * Assistant TEXT is deliberately ignored, so a live session that has already answered a plain
 * user turn matches the next request's prefix (the FE's assistant turn contributes nothing).
 * Tool-call ids ARE included, so an edited history trips a mismatch and degrades to cold
 * replay rather than continuing wrongly. Ids are DEDUPED (unique, first-seen order): a resolved
 * tool call rides the wire as a `tool_call` block PLUS a `tool_result` block sharing one id
 * (vercel `messages.py` `_tool_part_blocks`), and the park-time prediction
 * (`expectedNextHistoryFingerprint`) folds each emitted id in once — dedupe makes the two agree
 * while a genuinely different id SET still mismatches.
 *
 * The dispatch stores the fingerprint the next request is EXPECTED to hash to (see
 * `expectedNextHistoryFingerprint`), and checks the next request against the fingerprint of its
 * PRIOR messages (everything before the new user tail), so a plain conversational continuation
 * matches and any divergence falls to cold.
 */
export function historyFingerprint(messages: readonly ChatMessage[]): string {
  const userTexts: string[] = [];
  const toolCallIds: string[] = [];
  const seenIds = new Set<string>();
  let promptCount = 0;
  for (const message of messages) {
    if (message.role === "user") {
      promptCount += 1;
      userTexts.push(messageText(message.content));
    }
    collectToolCallIds(message.content, toolCallIds, seenIds);
  }
  return sha256(canonicalJson({ userTexts, toolCallIds, promptCount }));
}

/**
 * The fingerprint a park should record so the NEXT request's prior conversation matches it:
 * the full messages this turn ran, plus the tool-call ids the turn itself emitted, folded in
 * as one synthetic trailing assistant message.
 *
 * Why: the FE keeps an assistant turn iff it has an answer part (`agentRequest.ts`
 * `isAnswerPart`: non-empty text, `tool-*`/`dynamic-tool`, or file). So a tool-calling turn's
 * ids ALWAYS appear in the next request's prior messages, and a fully empty assistant turn is
 * pruned but contributes neither text nor ids — the prediction is deterministic either way
 * (assistant text is not hashed). An id divergence still trips a mismatch and falls to cold.
 */
export function expectedNextHistoryFingerprint(
  messages: readonly ChatMessage[],
  emittedToolCallIds: readonly string[],
): string {
  if (emittedToolCallIds.length === 0) return historyFingerprint(messages);
  const syntheticAssistantTurn: ChatMessage = {
    role: "assistant",
    content: emittedToolCallIds.map((id) => ({
      type: "tool_call",
      toolCallId: id,
    })),
  };
  return historyFingerprint([...messages, syntheticAssistantTurn]);
}

/**
 * The prior conversation for a continuation check: everything before the request's new user
 * tail. Mirrors `transcript.priorMessages` for the trailing-user case (the playground always
 * sends the new turn as the last user message), without importing that do-not-touch module.
 */
export function priorConversation(request: AgentRunRequest): ChatMessage[] {
  const messages = request.messages ?? [];
  if (messages.length && messages[messages.length - 1].role === "user") {
    return messages.slice(0, -1);
  }
  return messages.slice();
}

/**
 * The approval decision (allow/deny) the incoming request carries for a specific parked gate's
 * tool-call id, or undefined when the request has no approval envelope for that id. Reuses the
 * cold path's `approvalDecisionOf` (responder.ts) to parse the `{approved}` envelope, and matches
 * strictly by toolCallId (the parked gate's id) — never by name+args — so a live resume answers
 * exactly the gate that parked. An incoming reply for a different id, or a plain user message,
 * yields undefined and the dispatch degrades to cold.
 */
export function approvalDecisionForToolCall(
  request: AgentRunRequest,
  toolCallId: string,
): "allow" | "deny" | undefined {
  if (!toolCallId) return undefined;
  for (const message of request.messages ?? []) {
    const content = message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block?.type !== "tool_result" || block.toolCallId !== toolCallId) {
        continue;
      }
      const decision = approvalDecisionOf(block);
      if (decision !== undefined) return decision;
    }
  }
  return undefined;
}

/**
 * True when the request's tail is a fresh user message with text and NOT an approval envelope.
 * A continuation only takes the live path for a plain new user turn; an approval reply (a
 * trailing tool-role message, or a user turn carrying a tool_result) is slice 2's concern and
 * stays cold here.
 */
export function tailIsFreshUserMessage(request: AgentRunRequest): boolean {
  const messages = request.messages ?? [];
  const tail = messages[messages.length - 1];
  if (!tail || tail.role !== "user") return false;
  if (!messageText(tail.content).trim()) return false;
  if (Array.isArray(tail.content)) {
    const carriesToolTurn = tail.content.some(
      (block) => block?.type === "tool_result" || block?.type === "tool_call",
    );
    if (carriesToolTurn) return false;
  }
  return true;
}

/**
 * The credential epoch bounds how long a parked session may reuse its baked credentials. It is
 * a PROCESS-LOCAL hash over the actual resolved secret VALUES plus the tool-callback auth (held
 * only in runner memory — never logged, persisted, or emitted), combined with the mount
 * credential expiry. A rotated same-slug secret changes the hash; an elapsed expiry invalidates
 * the epoch. Either way the dispatch evicts and cold-starts with fresh credentials.
 */
export interface CredentialEpoch {
  /** sha256 over canonical(secrets) + tool-callback auth. In-memory only; never surfaced. */
  secretsHash: string;
  /** Mount credential expiry as epoch millis, or undefined when the sign response had none. */
  mountExpiresAtMs?: number;
}

export function computeCredentialEpoch(
  request: AgentRunRequest,
  mountExpiresAt?: string,
): CredentialEpoch {
  const material = canonicalJson({
    secrets: request.secrets ?? {},
    toolCallbackAuth: request.toolCallback?.authorization ?? null,
  });
  const parsed = mountExpiresAt ? Date.parse(mountExpiresAt) : NaN;
  return {
    secretsHash: sha256(material),
    mountExpiresAtMs: Number.isFinite(parsed) ? parsed : undefined,
  };
}

/**
 * Whether a parked session's MOUNT credentials have already expired, ignoring the secret material
 * hash entirely. This answers only "can the parked environment still write its durable cwd?".
 *
 * The approval-resume path uses this instead of `credentialEpochValid`: a resume must NOT require
 * the resume request's re-minted credentials to MATCH the parked ones (a fresh /run mints fresh
 * short-lived material every time, so they practically never match), but an expired mount means
 * the parked cwd can no longer be written, so it must still evict to cold.
 */
export function mountCredentialsExpired(
  epoch: CredentialEpoch,
  now = Date.now(),
): boolean {
  return epoch.mountExpiresAtMs !== undefined && now >= epoch.mountExpiresAtMs;
}

/**
 * Why a parked epoch is no longer usable for an incoming request's epoch, or undefined when it
 * still is. The two failure modes are distinguished so diagnosis works from logs:
 *  - `credentials-expired` — the mount credential's lifetime elapsed (time bound).
 *  - `credentials-rotated` — the resolved secret/tool-auth material changed (a rotated same-slug
 *    secret, a different tool-callback bearer).
 */
export function credentialEpochMismatch(
  parked: CredentialEpoch,
  incoming: CredentialEpoch,
  now = Date.now(),
): "credentials-expired" | "credentials-rotated" | undefined {
  if (mountCredentialsExpired(parked, now)) return "credentials-expired";
  if (parked.secretsHash !== incoming.secretsHash) return "credentials-rotated";
  return undefined;
}

/**
 * Whether a parked epoch is still valid for an incoming request's epoch. Invalid (evict, cold)
 * when the mount credential expired, or the resolved secret/tool-auth material changed. Thin
 * wrapper over `credentialEpochMismatch` for callers that only need the boolean.
 */
export function credentialEpochValid(
  parked: CredentialEpoch,
  incoming: CredentialEpoch,
  now = Date.now(),
): boolean {
  return credentialEpochMismatch(parked, incoming, now) === undefined;
}

/**
 * The pool key: `<projectId>:<sessionId>`. The project scope is the mount's owning project id,
 * the only project scope the runner can trust (the /run wire carries no project id). Returns
 * null when there is no session id or no mount project id — such a request MUST NOT park (there
 * is no safe key that separates callers), and the dispatch runs it fully cold.
 */
export function poolKeyFor(
  request: AgentRunRequest,
  mountProjectId: string | undefined,
): string | null {
  const sessionId = request.sessionId?.trim();
  const project = mountProjectId?.trim();
  if (!sessionId || !project) return null;
  return `${project}:${sessionId}`;
}

// --- The pool --------------------------------------------------------------- //

export type SessionState = "busy" | "idle" | "awaiting_approval" | "destroyed";

/**
 * One parked live session. `environment` is opaque to the pool (the engine reads it on a
 * continuation). `destroy` is the engine's complete, idempotent teardown closure.
 */
export interface LiveSession<E = unknown> {
  key: string;
  environment: E;
  configFingerprint: string;
  historyFingerprint: string;
  credentialEpoch: CredentialEpoch;
  state: SessionState;
  lastUsed: number;
  destroy: () => Promise<void>;
  /** Internal: the idle/approval TTL timer. */
  ttlTimer?: ReturnType<typeof setTimeout>;
}

/** Fields the caller supplies to park a session (the pool arms the timer and state itself). */
export interface ParkInput<E> {
  key: string;
  environment: E;
  configFingerprint: string;
  historyFingerprint: string;
  credentialEpoch: CredentialEpoch;
  destroy: () => Promise<void>;
}

/**
 * A per-replica map of parked live sessions with an LRU cap and TTL reaping. Single-threaded
 * (Node), so check-and-set on a key needs no lock. All teardown routes through the session's
 * one idempotent `destroy`.
 */
export class SessionPool<E = unknown> {
  private readonly sessions = new Map<string, LiveSession<E>>();

  constructor(
    private readonly config: Pick<KeepaliveConfig, "poolMax">,
    private readonly logger: (message: string) => void = log,
  ) {}

  /** Peek without mutating. */
  get(key: string): LiveSession<E> | undefined {
    return this.sessions.get(key);
  }

  size(): number {
    return this.sessions.size;
  }

  keys(): string[] {
    return [...this.sessions.keys()];
  }

  /** Test/inspection snapshot: key -> state. */
  snapshot(): Array<{ key: string; state: SessionState; lastUsed: number }> {
    return [...this.sessions.values()].map((s) => ({
      key: s.key,
      state: s.state,
      lastUsed: s.lastUsed,
    }));
  }

  /**
   * Check out an idle session for a continuation turn: clear its TTL timer, mark it busy, bump
   * its LRU stamp, and return it. Returns undefined when the key is absent or not idle (a busy
   * or awaiting_approval session is not checked out; the caller supersedes or falls to cold).
   */
  checkoutIdle(key: string): LiveSession<E> | undefined {
    const session = this.sessions.get(key);
    if (!session || session.state !== "idle") return undefined;
    this.clearTimer(session);
    session.state = "busy";
    session.lastUsed = Date.now();
    return session;
  }

  /**
   * Check out an approval-parked session for a live resume: clear its (longer) approval TTL timer,
   * REMOVE it from the map, mark it busy, and return it. Returns undefined when the key is absent
   * or not awaiting_approval. Removing it is what makes a racing request safe: the resume turn
   * owns the environment exclusively, a duplicate approval or fresh message simply misses the pool
   * and runs cold (today's concurrent-request semantics), and no supersede path can destroy the
   * environment while it is executing the just-approved tool. The gate is therefore answered at
   * most once: only the checkout winner ever holds the parked permission id. After the resume
   * turn, `repark` re-inserts only if the slot is still empty (see there).
   */
  checkoutApproval(key: string): LiveSession<E> | undefined {
    const session = this.sessions.get(key);
    if (!session || session.state !== "awaiting_approval") return undefined;
    this.clearTimer(session);
    this.sessions.delete(key);
    session.state = "busy";
    session.lastUsed = Date.now();
    return session;
  }

  /**
   * Return a checked-out (busy) session to the pool after a completed turn: refresh its
   * fingerprints + credential epoch and re-arm the TTL timer, keeping the SAME live environment.
   * Two checkout shapes are handled:
   *  - `checkoutIdle` left the busy session IN the map: the slot must still hold this exact
   *    session (a racing turn may have superseded it — never clobber the newer one).
   *  - `checkoutApproval` REMOVED it from the map: re-insert only if the slot is still EMPTY;
   *    an occupant is a newer session parked by a racing request and must not be clobbered.
   * A destroyed session (e.g. drained by `destroyAll` mid-turn) is never resurrected.
   * Returns false when the session cannot return; the caller destroys its orphaned environment.
   */
  repark(
    session: LiveSession<E>,
    update: {
      configFingerprint: string;
      historyFingerprint: string;
      credentialEpoch: CredentialEpoch;
    },
    ttlMs: number,
    state: "idle" | "awaiting_approval" = "idle",
  ): boolean {
    if (session.state === "destroyed") return false;
    const current = this.sessions.get(session.key);
    if (current !== undefined && current !== session) return false;
    if (current === undefined) {
      // Re-inserting a checked-out-and-removed session: respect the cap like `park` does.
      if (this.sessions.size >= this.config.poolMax && !this.evictLruIdle()) {
        this.logger(
          `re-park skipped (pool full, nothing idle to evict) key=${session.key}`,
        );
        return false;
      }
      this.sessions.set(session.key, session);
    }
    this.clearTimer(session);
    session.configFingerprint = update.configFingerprint;
    session.historyFingerprint = update.historyFingerprint;
    session.credentialEpoch = update.credentialEpoch;
    session.state = state;
    session.lastUsed = Date.now();
    this.armTtl(session, ttlMs, state);
    this.logger(
      `park key=${session.key} ttl=${ttlMs}ms state=${state} (re-park) poolSize=${this.sessions.size}`,
    );
    return true;
  }

  /**
   * Best-effort park. LRU-evicts an idle entry when the pool is full; never evicts a busy or
   * awaiting_approval session. If nothing evictable frees a slot, the session is NOT parked and
   * the caller tears it down as today (parking is best-effort). Returns whether it parked.
   */
  async park(
    input: ParkInput<E>,
    ttlMs: number,
    state: "idle" | "awaiting_approval" = "idle",
  ): Promise<boolean> {
    // A supersede/re-park on the same key replaces any prior entry (destroy the old one first).
    // AWAIT the teardown before taking the slot, exactly like `evict`: the replaced session shares
    // the SAME durable cwd/mount as the successor, so its unmount/delete must complete BEFORE the
    // new session is parked, or the old destroy could unmount the cwd out from under the successor.
    const existing = this.sessions.get(input.key);
    if (existing) {
      this.clearTimer(existing);
      this.sessions.delete(input.key);
      await this.safeDestroy(existing);
    }

    if (this.sessions.size >= this.config.poolMax && !this.evictLruIdle()) {
      this.logger(
        `park skipped (pool full, nothing idle to evict) key=${input.key}`,
      );
      return false;
    }

    const session: LiveSession<E> = {
      key: input.key,
      environment: input.environment,
      configFingerprint: input.configFingerprint,
      historyFingerprint: input.historyFingerprint,
      credentialEpoch: input.credentialEpoch,
      state,
      lastUsed: Date.now(),
      destroy: input.destroy,
    };
    this.armTtl(session, ttlMs, state);
    this.sessions.set(input.key, session);
    this.logger(
      `park key=${input.key} ttl=${ttlMs}ms state=${state} poolSize=${this.sessions.size}`,
    );
    return true;
  }

  /**
   * Arm the TTL reaper on a parked session. An idle park uses the short idle TTL; an approval park
   * uses the longer approval TTL and logs `approval-ttl-expire` when it fires so an expired
   * approval (which degrades to the cold decision-map path) is greppable. Never lets the timer
   * keep the process alive on its own.
   */
  private armTtl(
    session: LiveSession<E>,
    ttlMs: number,
    state: "idle" | "awaiting_approval",
  ): void {
    const label =
      state === "awaiting_approval" ? "approval-ttl-expire" : "expire";
    session.ttlTimer = setTimeout(() => {
      this.logger(`${label} key=${session.key} (TTL ${ttlMs}ms)`);
      void this.evict(session.key, label);
    }, ttlMs);
    session.ttlTimer.unref?.();
  }

  /**
   * Remove a key and destroy it. Idempotent: a missing key is a no-op (resolves false).
   * The returned promise resolves once the destroy completed, so a caller that reacquires the
   * same key (same durable cwd / mount) MUST await it — the old teardown's unmount must not
   * overlap the new acquire. Fire-and-forget callers (the TTL timer) `void` it.
   * `reason` feeds the greppable `[keepalive] evict` log line.
   */
  async evict(key: string, reason: string): Promise<boolean> {
    const session = this.sessions.get(key);
    if (!session) return false;
    this.clearTimer(session);
    this.sessions.delete(key);
    this.logger(`evict key=${key} reason=${reason}`);
    await this.safeDestroy(session);
    return true;
  }

  /**
   * Identity-checked eviction for a session THIS caller checked out: removes the map entry only
   * when the key still points at this exact session (a racing turn may have superseded it and
   * parked its own session under the same key — that newer session must not be clobbered), then
   * awaits the destroy of THIS session either way (its environment belongs to the caller and is
   * dead; destroy is idempotent, so a supersede that already destroyed it is a no-op).
   */
  async evictIfCurrent(session: LiveSession<E>, reason: string): Promise<void> {
    if (this.sessions.get(session.key) === session) {
      this.clearTimer(session);
      this.sessions.delete(session.key);
      this.logger(`evict key=${session.key} reason=${reason}`);
    }
    await this.safeDestroy(session);
  }

  /** Remove a key and AWAIT its destroy. Idempotent. */
  async destroy(key: string): Promise<void> {
    const session = this.sessions.get(key);
    if (!session) return;
    this.clearTimer(session);
    this.sessions.delete(key);
    this.logger(`destroy key=${key}`);
    await this.safeDestroy(session);
  }

  /**
   * Destroy every parked session, timeout-bounded so it can never hang shutdown (mirrors
   * `destroyInFlightSandboxes`). Drains the map first so a concurrent park cannot re-add.
   */
  async destroyAll(timeoutMs = 5000): Promise<void> {
    const pending = [...this.sessions.values()];
    this.sessions.clear();
    if (pending.length === 0) return;
    for (const session of pending) this.clearTimer(session);
    this.logger(`destroyAll count=${pending.length}`);
    const sweep = Promise.allSettled(
      pending.map((session) => this.safeDestroy(session)),
    );
    await Promise.race([
      sweep,
      new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
    ]);
  }

  private evictLruIdle(): boolean {
    let oldest: LiveSession<E> | undefined;
    for (const session of this.sessions.values()) {
      if (session.state !== "idle") continue;
      if (!oldest || session.lastUsed < oldest.lastUsed) oldest = session;
    }
    if (!oldest) return false;
    this.clearTimer(oldest);
    this.sessions.delete(oldest.key);
    this.logger(`evict key=${oldest.key} reason=lru`);
    void this.safeDestroy(oldest);
    return true;
  }

  private clearTimer(session: LiveSession<E>): void {
    if (session.ttlTimer) {
      clearTimeout(session.ttlTimer);
      session.ttlTimer = undefined;
    }
  }

  private async safeDestroy(session: LiveSession<E>): Promise<void> {
    session.state = "destroyed";
    try {
      await session.destroy();
    } catch (err) {
      this.logger(
        `destroy failed key=${session.key}: ${String(
          err instanceof Error ? err.message : err,
        ).slice(0, 200)}`,
      );
    }
  }
}
