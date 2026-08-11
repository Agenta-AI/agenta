import { createHash, timingSafeEqual } from "node:crypto";
import { inspect } from "node:util";

import {
  currentUserTurn,
  isLegacyInlineImageBlock,
  type AgentRunRequest,
  type ChatMessage,
  type ContentBlock,
  messageText,
  resolvePromptText,
  userTurnCarriesContent,
} from "../../protocol.ts";
import { approvalDecisionOf } from "../../responder.ts";
import { resolveCodexMode } from "./codex-mode.ts";
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
// Ten minutes. An approval park by definition has a pending interaction row waiting on a human,
// and answers increasingly arrive from a phone minutes later (mobile approvals plan,
// 2026-07-27 §4b-4): a 5-minute window pushed most of those onto the slower cold-replay path.
// Thirty was the first attempt at covering that; ten covers the same phone-latency case without
// holding a pool slot for half an hour on a gate nobody is coming back to.
// The window is still bounded by the mount-credential expiry check, expiry degrades to cold
// (never fails the turn), and an awaiting_approval entry keeps holding a pool slot — override
// via AGENTA_RUNNER_SESSION_APPROVAL_TTL_MS if warm slots are contended.
const DEFAULT_APPROVAL_TTL_MS = 600_000;
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
  if (raw === "1" || raw === "true" || raw === "yes" || raw === "on")
    return true;
  if (raw === "0" || raw === "false" || raw === "no" || raw === "off")
    return false;
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
      poolMax: positiveIntEnv(DAYTONA_POOL_MAX_ENV, DEFAULT_DAYTONA_POOL_MAX),
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

/**
 * The credential material a session was built with, kept only so a later turn can answer one
 * question: did any of it change?
 *
 * It holds the values rather than a digest of them, and that is deliberate. A digest of an API
 * key is not much protection (keys have little enough entropy that a leaked digest can be
 * attacked offline), and it invites exactly the misreading that a security scanner makes: that
 * this is a password hash, which it is not. Nothing here authenticates anything.
 *
 * The real risk with holding the values is that one leaks into a log line, so this class makes
 * that structurally impossible instead of relying on a convention. The material lives in a
 * private field with no getter, and every way of turning an object into text (`String()`, a
 * template literal, `JSON.stringify`, `console.log` / `util.inspect`) is overridden to print a
 * placeholder. This mirrors what the Python side already does for the same reason
 * (`ResolvedCredential` masks its value on dump and hides it from `repr`).
 *
 * Comparison is constant time so the check cannot be turned into a way to learn a key one byte
 * at a time.
 */
export class CredentialMaterial {
  readonly #canonical: string;

  constructor(canonical: string) {
    this.#canonical = canonical;
  }

  /** True when both were built from identical credential material. */
  equals(other: CredentialMaterial): boolean {
    const mine = Buffer.from(this.#canonical, "utf8");
    const theirs = Buffer.from(other.#canonical, "utf8");
    // `timingSafeEqual` throws on a length mismatch, and lengths differ freely here, so the
    // length check comes first. Length is not secret: it follows from the request's shape,
    // which the config fingerprint already covers in the clear.
    return mine.length === theirs.length && timingSafeEqual(mine, theirs);
  }

  toString(): string {
    return "[credential-material]";
  }

  toJSON(): string {
    return "[credential-material]";
  }

  [inspect.custom](): string {
    return "[credential-material]";
  }
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
 * (`context`), the rotating telemetry headers, and credential VALUES
 * (`modelConnection.credentials` / MCP `connection.credentials` — the credential epoch covers
 * rotation, and values must never enter any hash used for logging). The tool-callback ENDPOINT
 * is included (routing config); its authorization is per-turn credential material excluded from
 * every hash, the credential epoch included — each turn's relay uses the INCOMING request's
 * `toolCallback` (see `CredentialEpoch` and `run-turn.ts`), so the parked copy never executes
 * anything.
 *
 * LIFECYCLE MIGRATION, STEP 1. The workflow REVISION id, the revision version, and the draft flag
 * were in this hash and are now out. They are turn METADATA, not environment identity: nothing in
 * the sandbox, the daemon, the workspace, or the harness session changes when a revision id
 * changes. Keeping them here meant that committing a revision mid-conversation threw away a warm
 * sandbox that was still perfectly usable, which is the exact cost this project exists to remove.
 * They stay in `runContext` for tool binding and observability; they simply no longer decide
 * whether an environment may be reused.
 */
export function configFingerprint(request: AgentRunRequest): string {
  const shape = {
    harness: request.harness ?? null,
    sandbox: request.sandbox ?? null,
    model: request.model ?? null,
    // Harness mode is applied once, at session acquire (codex-mode.ts). Normalize Codex defaults
    // and ignore the field for other harnesses so only effective mode changes evict warm sessions.
    harnessMode:
      request.harness === "codex"
        ? resolveCodexMode(request.harnessMode)
        : null,
    connection: request.connection ?? null,
    modelConnection: request.modelConnection
      ? {
          provider: request.modelConnection.provider,
          deployment: request.modelConnection.deployment,
          endpoint: request.modelConnection.endpoint ?? null,
          credentialMode: request.modelConnection.credentialMode,
          environment: request.modelConnection.environment ?? null,
          credentials: (request.modelConnection.credentials ?? []).map(
            (credential) => ({
              binding: credential.binding,
              usage: credential.usage,
            }),
          ),
        }
      : null,
    modelCapabilities: request.modelCapabilities ?? null,
    agentsMd: request.agentsMd ?? null,
    systemPrompt: request.systemPrompt ?? null,
    appendSystemPrompt: request.appendSystemPrompt ?? null,
    skills: request.skills ?? null,
    customTools: request.customTools ?? null,
    // Credential VALUES are stripped (binding + usage identify the shape); public headers are
    // config and stay in.
    mcpServers:
      request.mcpServers?.map((server) => ({
        ...server,
        connection: {
          ...server.connection,
          credentials: server.connection?.credentials?.map((credential) => ({
            binding: credential.binding,
            usage: credential.usage,
          })),
        },
      })) ?? null,
    toolCallbackEndpoint: request.toolCallback?.endpoint ?? null,
    permissions: request.permissions ?? null,
    sandboxPermission: request.sandboxPermission ?? null,
    harnessFiles: request.harnessFiles ?? null,
    // No `workflowRevision` and no `isDraft`. See the doc comment above.
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
 * One stable digest per legacy inline-media block: its media type plus a hash of the payload,
 * so the fingerprint stays short whatever the image weighs.
 */
function inlineMediaDigests(
  content: string | ContentBlock[] | undefined,
): string[] {
  if (!Array.isArray(content)) return [];
  const digests: string[] = [];
  for (const block of content) {
    if (!isLegacyInlineImageBlock(block)) continue;
    const payload =
      typeof block.uri === "string" && block.uri.startsWith("data:")
        ? block.uri
        : String(block.data ?? "");
    const mediaType = typeof block.mimeType === "string" ? block.mimeType : "";
    digests.push(sha256(`${mediaType}\n${payload}`));
  }
  return digests;
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
  const userAttachmentIds: string[][] = [];
  const userInlineMedia: string[][] = [];
  const toolCallIds: string[] = [];
  const seenIds = new Set<string>();
  let promptCount = 0;
  for (const message of messages) {
    if (message.role === "user") {
      promptCount += 1;
      userTexts.push(messageText(message.content));
      userAttachmentIds.push(
        currentUserTurn({ messages: [message] }).attachments.map(
          (attachment) => attachment.attachmentId,
        ),
      );
      // A legacy inline image carries no reference id, so hash its content: two histories that
      // differ only in the image bytes must not share one warm harness.
      userInlineMedia.push(inlineMediaDigests(message.content));
    }
    collectToolCallIds(message.content, toolCallIds, seenIds);
  }
  // Attachment ids change every canonical hash once; deploys already cold-start parked
  // sessions because the pool is process-local.
  return sha256(
    canonicalJson({
      userTexts,
      userAttachmentIds,
      userInlineMedia,
      toolCallIds,
      promptCount,
    }),
  );
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
 * True when the request ASSERTED a transcript beyond its own turn: its prior conversation (see
 * `priorConversation`) still holds a user message. A last-message-only client never does (its
 * prior conversation is empty), and neither does turn one of any conversation, which carries a
 * single user message however the client sends history.
 *
 * A park records this so the resume knows how much of the incoming transcript the parked
 * fingerprint can legitimately be compared against: a park whose request carried only the
 * trailing user turn can only vouch for that turn and the tool calls it produced — see
 * `historyTailFromLastUserTurn`.
 */
export function assertsPriorConversation(request: AgentRunRequest): boolean {
  return priorConversation(request).some((message) => message.role === "user");
}

/**
 * The tail of a conversation from its LAST user message onward (inclusive); the whole array when
 * it holds no user message. This is exactly the span a minimal park's fingerprint covers: the
 * one user turn its request carried plus that turn's own tool calls. Everything earlier is
 * history the park never saw and therefore cannot check.
 */
export function historyTailFromLastUserTurn(
  messages: readonly ChatMessage[],
): ChatMessage[] {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === "user") return messages.slice(i);
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
 * True when the request carries exactly its own fresh user turn and no prior conversation —
 * what a last-message-only client sends. The single predicate both sides agree on: the runner
 * reconstructs prior turns only for such a request, and the keep-alive check skips its history
 * comparison for one, because the client is no longer asserting the conversation at all.
 *
 * A message count alone is NOT enough: turn one of any conversation is also a single message,
 * and a lone assistant message or an empty array are neither a fresh turn nor a full history.
 */
export function carriesMinimalHistory(request: AgentRunRequest): boolean {
  const messages = request.messages ?? [];
  return messages.length === 1 && tailIsFreshUserMessage(request);
}

/**
 * True when the request is an OUT-OF-BAND approval reply: it carries an approval envelope and no
 * prompt text. That is what a caller answering from the durable interaction row alone sends
 * (an inbox, a webhook, a CLI) — the parked tool call plus its `{approved}` result, nothing else.
 *
 * "No prompt text" means exactly what `resolvePromptText` reads and nothing more: `text` blocks on
 * a `role: "user"` message. Text carried any other way (a non-`text` block type, another role)
 * does not disqualify a request here — deliberately, because this predicate decides whether the
 * run has a prompt to SEND, and `resolvePromptText` is what produces that prompt. The two must
 * agree; a stricter check here would classify a request as having a prompt the run then omits.
 *
 * Such a request is the mirror image of `carriesMinimalHistory`: it asserts no conversation, so
 * the prior turns come from the durable record log and there is no history for the keep-alive
 * check to compare. It also has no prompt to send, which is why `buildRunPlan` must not reject it
 * for having none. A playground approval reply carries the full transcript (its user turns
 * included) and is therefore NOT this shape.
 */
export function carriesApprovalReplyOnly(request: AgentRunRequest): boolean {
  if (resolvePromptText(request)) return false;
  // The reply must be the request's terminal tool envelope, not merely present somewhere: a
  // history whose newest envelope is an unresolved call is a stalled conversation, and reading
  // it as an approval reply would let it through the empty-prompt rejection.
  const messages = request.messages ?? [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const content = messages[i]?.content;
    if (!Array.isArray(content)) continue;
    const envelope = content.filter(
      (block) => block?.type === "tool_call" || block?.type === "tool_result",
    );
    if (envelope.length === 0) continue;
    return envelope.some(
      (block) =>
        block.type === "tool_result" && approvalDecisionOf(block) !== undefined,
    );
  }
  return false;
}

/**
 * True when the request's tail is a fresh user message with content and NOT an approval envelope.
 * A continuation only takes the live path for a plain new user turn; an approval reply (a
 * trailing tool-role message, or a user turn carrying a tool_result) stays cold here.
 */
export function tailIsFreshUserMessage(request: AgentRunRequest): boolean {
  const turn = currentUserTurn(request);
  return turn.isFresh && userTurnCarriesContent(turn);
}

/**
 * The credential epoch bounds how long a parked session may reuse its baked credentials. It pairs
 * the resolved secret material (see `CredentialMaterial`: process-local, never logged, persisted,
 * or emitted) with the mount credential expiry. A rotated same-slug secret changes the material;
 * an elapsed expiry invalidates the epoch. Either way the dispatch evicts and cold-starts with
 * fresh credentials.
 *
 * The tool-callback bearer is deliberately EXCLUDED: it is per-turn material the backend
 * re-mints on its auth-cache cadence (~60s), and every turn — continuation included — starts
 * its tool relay from the INCOMING request's `toolCallback`, so the parked copy is never used
 * to execute anything. Including it made warm sessions evict as "credentials-rotated" on every
 * cache rollover for no protective value. Only material actually BAKED into the parked
 * environment (the sandbox env secrets) belongs here; the mount expiry bounds the rest.
 */
export interface CredentialEpoch {
  /** The credentials this session was built with. Compared, never read. */
  secrets: CredentialMaterial;
  /**
   * The half of that material a live delivery can NEVER reach: public model config
   * (`modelConnection.environment`) and `local_use` credentials.
   *
   * WHY IT IS SPLIT OUT (lifecycle migration, step 8). A `local_use` credential is read by the
   * provider SDK inside the sandbox, so it is baked into the daemon environment at create and no
   * amount of vault work changes it; only the `opaque_http` half lives behind a Daytona Secret
   * reference the runner can rotate in place. `configFingerprint` strips credential VALUES, so a
   * rotated `AWS_SECRET_ACCESS_KEY` is invisible to it and surfaces ONLY as a moved epoch.
   *
   * Without this field the live credential route would answer such a rotation by updating vault
   * records that do not hold it, report success, and keep a sandbox running on the OLD value.
   * The route therefore requires this half to be unchanged and rebuilds otherwise. Same material,
   * same never-logged holder; it is a second question asked of the same secrets, not a second copy
   * of anything the epoch did not already retain.
   */
  direct: CredentialMaterial;
  /**
   * Parked epochs only: the environment's installed-mount lease as epoch millis, or undefined when
   * it has no mounts. Incoming epochs never carry one.
   */
  mountExpiresAtMs?: number;
}

/**
 * A signed mount's `expiresAt` (ISO 8601, as it rides the sign response) as epoch millis, or
 * undefined when absent or unparsable. The one conversion both the credential epoch and the
 * installed-mount lease go through, so they can never disagree about what an expiry means.
 */
export function mountExpiryMs(
  expiresAt: string | undefined,
): number | undefined {
  const parsed = expiresAt ? Date.parse(expiresAt) : NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * The epoch an INCOMING request carries: just the secret material — the typed model credentials
 * and the typed MCP header credentials, i.e. exactly what gets BAKED into the sandbox/session
 * environment (plaintext locally; Daytona Secret records remotely). An incoming request has no
 * mount lease of its own to contribute; a parked epoch's `mountExpiresAtMs` is stamped from the
 * environment's installed mounts at park time (see `installedMountLease`).
 */
export function computeCredentialEpoch(
  request: AgentRunRequest,
): CredentialEpoch {
  const material = canonicalJson({
    modelEnvironment: request.modelConnection?.environment ?? {},
    modelCredentials: (request.modelConnection?.credentials ?? []).map(
      (credential) => ({
        binding: credential.binding,
        value: credential.value,
        usage: credential.usage,
      }),
    ),
    mcpCredentials: (request.mcpServers ?? []).flatMap((server) =>
      (server.connection?.credentials ?? []).map((credential) => ({
        server: server.name,
        url: server.connection?.url ?? null,
        binding: credential.binding,
        value: credential.value,
        usage: credential.usage,
      })),
    ),
  });
  // The half no live delivery can reach. See `CredentialEpoch.direct`: these values are read
  // locally by the provider SDK, so they are baked into the daemon environment at create.
  const directMaterial = canonicalJson({
    modelEnvironment: request.modelConnection?.environment ?? {},
    localUseCredentials: (request.modelConnection?.credentials ?? [])
      .filter((credential) => credential.usage === "local_use")
      .map((credential) => ({
        binding: credential.binding,
        value: credential.value,
      })),
  });
  return {
    secrets: new CredentialMaterial(material),
    direct: new CredentialMaterial(directMaterial),
  };
}

/** True when credentials baked into a parked sandbox/session changed (rotation ⇒ evict). */
export function sandboxCredentialsRotated(
  parked: CredentialEpoch,
  incoming: CredentialEpoch,
): boolean {
  return !parked.secrets.equals(incoming.secrets);
}

/**
 * Expiry (epoch millis) of the credentials actually installed in each of an environment's running
 * geesefs daemons. Per mount kind, because a remount replaces one mount's credentials and must not
 * inherit the other's.
 */
export interface InstalledMountExpiries {
  cwd?: number;
  agent?: number;
}

/** The environment's credential lease: the earliest expiry among its installed mounts. */
export function installedMountLease(
  expiries: InstalledMountExpiries,
): number | undefined {
  const values = Object.values(expiries).filter(
    (v): v is number => typeof v === "number",
  );
  return values.length ? Math.min(...values) : undefined;
}

/**
 * Whether a lease is spent as of `asOfMs`: an undefined lease imposes no bound, and a lease landing
 * exactly on `asOfMs` counts as spent. The one place the lease comparison lives, so "already dead"
 * and "dead before the turn ends" can never drift apart.
 */
export function leaseExpiresBy(
  leaseMs: number | undefined,
  asOfMs: number,
): boolean {
  return leaseMs !== undefined && leaseMs <= asOfMs;
}

/**
 * Whether a parked session's MOUNT credentials have already expired, ignoring the secret material
 * hash entirely. The approval-resume path uses this instead of `credentialEpochValid`: a resume
 * must NOT require the resume request's re-minted credentials to MATCH the parked ones, but an
 * expired mount means the parked cwd can no longer be written, so it must still evict to cold.
 */
export function mountCredentialsExpired(
  epoch: CredentialEpoch,
  now = Date.now(),
): boolean {
  return leaseExpiresBy(epoch.mountExpiresAtMs, now);
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
  if (!parked.secrets.equals(incoming.secrets)) return "credentials-rotated";
  return undefined;
}

/**
 * A fixed allowance for clock differences between the API, the store, and the runner, plus the
 * seconds a cold rebuild spends mounting before the turn starts. Not operator-tunable: it protects
 * an invariant, and a third time knob would only invite mis-setting it.
 */
export const MOUNT_LEASE_SKEW_MS = 60_000;

/**
 * Whether the parked mount credentials expire by `requiredValidThroughMs`, i.e. the lease cannot
 * cover a full worst-case turn. Distinct from `mountCredentialsExpired`, which asks only whether
 * the lease is already dead.
 */
export function mountCredentialsExpireBy(
  epoch: CredentialEpoch,
  requiredValidThroughMs: number,
): boolean {
  return leaseExpiresBy(epoch.mountExpiresAtMs, requiredValidThroughMs);
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
  if (runContextProject)
    return { id: runContextProject, source: "run-context" };
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
