import { createHash } from "node:crypto";

import {
  type AgentRunRequest,
  type ChatMessage,
  type ContentBlock,
  messageText,
} from "../../protocol.ts";
import { approvalDecisionOf } from "../../responder.ts";
import type { TeardownReason } from "./teardown.ts";
import { loadRunnerConfig } from "../../config/runner-config.ts";

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

export type KeepaliveProviderName = "local" | "daytona";

const KEEPALIVE_ENV = "AGENTA_RUNNER_SESSION_KEEPALIVE";
const TTL_ENV = "AGENTA_RUNNER_SESSION_TTL_MS";
const APPROVAL_TTL_ENV = "AGENTA_RUNNER_SESSION_APPROVAL_TTL_MS";
const POOL_MAX_ENV = "AGENTA_RUNNER_SESSION_POOL_MAX";

const DEFAULT_TTL_MS = 60_000;
const DEFAULT_APPROVAL_TTL_MS = 300_000;
const DEFAULT_POOL_MAX = 8;
const DAYTONA_TTL_ENV = "AGENTA_RUNNER_DAYTONA_SESSION_IDLE_TTL_MS";
const DAYTONA_POOL_MAX_ENV = "AGENTA_RUNNER_DAYTONA_SESSION_MAX_WARM";
// Two minutes: the shipping default decided in the plan (about half a cent per parked turn),
// enabled after the E3 live verification. 0 disables keeping Daytona sandboxes running.
const DEFAULT_DAYTONA_TTL_MS = 120_000;
const DEFAULT_DAYTONA_POOL_MAX = 20;

function positiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

/**
 * Like `positiveIntEnv` but zero is a VALID value, not a fallback trigger. The Daytona idle
 * TTL uses this because 0 is its documented off switch; with a nonzero shipping default, a
 * positive-only parse would silently turn "0" back into the default.
 */
function nonNegativeIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
}

function boolEnv(name: string, fallback: boolean): boolean {
  const raw = (process.env[name] ?? "").trim().toLowerCase();
  if (!raw) return fallback;
  if (raw === "1" || raw === "true" || raw === "yes" || raw === "on") return true;
  if (raw === "0" || raw === "false" || raw === "no" || raw === "off") return false;
  return fallback;
}

/** Read one provider's keep-alive config from the environment. */
export function readKeepaliveConfig(
  provider: KeepaliveProviderName,
): KeepaliveConfig {
  if (provider === "daytona") {
    const ttlMs = nonNegativeIntEnv(DAYTONA_TTL_ENV, DEFAULT_DAYTONA_TTL_MS);
    // Keep this live window comfortably below the signed mount-credential lifetime. The
    // existing credential-epoch check evicts to cold when those credentials expire.
    return {
      enabled: ttlMs > 0,
      ttlMs,
      // Pending approvals on Daytona take the cold path until the F-018 gate plan lands; the
      // pool never sees an awaiting_approval park for Daytona today because parkedApproval is
      // only set by ACP gates.
      approvalTtlMs: ttlMs,
      // This budgets billed compute (idle warm sandboxes), deliberately separate from the local
      // pool's host-memory budget; Slice 4 adds the strict warm-slot accounting semantics.
      poolMax: positiveIntEnv(
        DAYTONA_POOL_MAX_ENV,
        DEFAULT_DAYTONA_POOL_MAX,
      ),
    };
  }
  return {
    enabled: boolEnv(KEEPALIVE_ENV, true),
    ttlMs: positiveIntEnv(TTL_ENV, DEFAULT_TTL_MS),
    approvalTtlMs: positiveIntEnv(APPROVAL_TTL_ENV, DEFAULT_APPROVAL_TTL_MS),
    poolMax: positiveIntEnv(POOL_MAX_ENV, DEFAULT_POOL_MAX),
  };
}

/**
 * `poolMax` (and the LRU/TTL eviction it drives) is a LOCAL-provider parameter — "how many
 * ~300 MB hot Claude trees fit on this runner host" — never a global one. Mirrors `run-plan.ts`'s
 * own sandbox-id resolution (`request.sandbox || configured default provider`). The pool dispatch
 * (`server.ts` `isLocalSandbox`) and the continuity module's own local/remote framing both
 * resolve through this one function, so the "local-only" invariant has a single source of truth.
 */
export function resolvesToLocalProvider(
  requestSandbox: string | undefined,
  defaultProvider: string = loadRunnerConfig().providers.default,
): boolean {
  return (requestSandbox || defaultProvider) === "local";
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
 * A canonical hash over the config-bearing request fields (the continuation-versus-cold
 * decision). Per-turn volatiles are excluded: `messages`, `turnId`, trace propagation
 * (`context`), the rotating telemetry headers, and secret VALUES (`secrets` — the credential
 * epoch covers rotation, and values must never enter any hash used for logging). The
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
 * trailing tool-role message, or a user turn carrying a tool_result) stays cold here.
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
 * a PROCESS-LOCAL hash over the actual resolved secret VALUES (held only in runner memory —
 * never logged, persisted, or emitted), combined with the mount credential expiry. A rotated
 * same-slug secret changes the hash; an elapsed expiry invalidates the epoch. Either way the
 * dispatch evicts and cold-starts with fresh credentials.
 *
 * The tool-callback bearer is deliberately EXCLUDED: it is per-turn material the backend
 * re-mints on its auth-cache cadence (~60s), and every turn — continuation included — starts
 * its tool relay from the INCOMING request's `toolCallback`, so the parked copy is never used
 * to execute anything. Hashing it made warm sessions evict as "credentials-rotated" on every
 * cache rollover for no protective value. Only material actually BAKED into the parked
 * environment (the sandbox env secrets) belongs in the hash; the mount expiry bounds the rest.
 */
export interface CredentialEpoch {
  /** sha256 over canonical(secrets). In-memory only; never surfaced. */
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
 *  - `credentials-rotated` — the resolved secret material changed (a rotated same-slug secret).
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
 * when the mount credential expired, or the resolved secret material changed. Thin
 * wrapper over `credentialEpochMismatch` for callers that only need the boolean.
 */
export function credentialEpochValid(
  parked: CredentialEpoch,
  incoming: CredentialEpoch,
  now = Date.now(),
): boolean {
  return credentialEpochMismatch(parked, incoming, now) === undefined;
}

/** Which project-scope source produced a pool key: the service-stamped run context, or the mount. */
export type PoolScopeSource = "run-context" | "mount";

/** A pool key plus the scope source that produced it (for the greppable `[keepalive] scope=` log). */
export interface PoolScope {
  key: string;
  source: PoolScopeSource;
}

/**
 * The project scope for a run: PREFERRED from the run context the service stamps server-side
 * (`runContext.project.id`), FALLING BACK to the mount's owning project id when the run context
 * carries none. The run-context id is the trustworthy source: the service derives it from its own
 * request state (never from a caller-supplied wire field), so it does not depend on a durable
 * mount existing. The mount scope stays as the fallback for the transition and for runs without a
 * stamped project. Returns undefined when NEITHER source yields a scope.
 *
 * This is the single precedence rule other project-scoped decisions (the pool key, the in-flight
 * sandbox kill filter) must reuse rather than re-deriving, so they agree by construction.
 */
export function projectScopeFor(
  request: Pick<AgentRunRequest, "runContext">,
  mountProjectId: string | undefined,
): { id: string; source: PoolScopeSource } | undefined {
  const runContextProject = request.runContext?.project?.id?.trim();
  if (runContextProject) return { id: runContextProject, source: "run-context" };
  const mount = mountProjectId?.trim();
  if (mount) return { id: mount, source: "mount" };
  return undefined;
}

/**
 * The pool key: `<projectId>:<sessionId>`. Provider separation does not need another key segment:
 * providers have separate pools, and `configFingerprint` includes `request.sandbox`.
 *
 * Returns null when there is no session id, or when `projectScopeFor` yields no project scope —
 * such a request MUST NOT park (there is no safe key that separates callers), and the dispatch
 * runs it fully cold. This no-scope-no-park rule is the keep-alive safety invariant and is
 * unchanged.
 */
export function poolKeyFor(
  request: AgentRunRequest,
  mountProjectId: string | undefined,
): PoolScope | null {
  const sessionId = request.sessionId?.trim();
  if (!sessionId) return null;
  const scope = projectScopeFor(request, mountProjectId);
  if (!scope) return null;
  return { key: `${scope.id}:${sessionId}`, source: scope.source };
}
