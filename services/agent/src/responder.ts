/**
 * The interaction responder seam.
 *
 * A harness (the ACP "Agent") does not only emit tool calls. It also raises typed
 * reverse-RPC interaction requests that something must answer: permission gates today,
 * elicitation (input) and client-side tools later. Today the sandbox-agent runner answered the
 * permission gate inline with a hardcoded auto-approve. This module lifts that decision
 * behind a `Responder` interface so it is pluggable:
 *
 *   - `PolicyResponder` is the headless answer (a fixed `auto` / `deny` policy, no human).
 *     It reproduces the previous behavior exactly and is what `/invoke` uses.
 *   - `HITLResponder` is the cross-turn responder (the `/messages` HITL path): it parks an
 *     un-decided permission (the `interaction_request` already went to the browser), ends the
 *     turn, and resolves on the next turn's stored reply. With no decision and no human
 *     surface it falls back to the base policy, so the headless path is unchanged. The harness
 *     adapter does not change when the responder does.
 *
 * Resolution is modeled as `allow` / `deny`; the adapter maps that onto the harness's
 * available ACP replies via `decisionToReply`.
 */

import type {
  AgentRunRequest,
  ContentBlock,
  ResolvedToolSpec,
} from "./protocol.ts";

/** HITL resume debug: traces stored-vs-live key matching that decides resolve-vs-re-park. */
function hitlDebug(message: string): void {
  process.stderr.write(`[hitl-resume] ${message}\n`);
}

export type PermissionPolicy = "auto" | "deny";

/**
 * What the responder decides for one permission gate.
 *
 *  - `allow` / `deny` are terminal: the adapter maps them onto an ACP reply via
 *    `decisionToReply` and the harness runs or refuses the tool this turn.
 *  - `park` is NOT a harness reply. It means "a human must decide; end the turn with this
 *    tool PENDING". On park the adapter sends NO `respondPermission`, so the harness never
 *    produces a refused/failed tool call, and the `interaction_request` already emitted stays
 *    the last word on the tool call. The next turn carries the stored decision and resolves it
 *    via `allow`/`deny`. This is the cross-turn HITL "park" — see `HITLResponder`.
 *
 * `decisionToReply` only ever sees `allow`/`deny`; `park` is handled before it (it has no ACP
 * reply). Do NOT "simplify" park back to `deny`: for Claude, replying `reject` produces a
 * failed tool call ("User refused permission") whose `tool_result {isError}` overwrites the
 * approval prompt on the same tool-call id (the F-024 clobber bug).
 */
export type PermissionDecision = "allow" | "deny";

/** The full set of responder outcomes, including the runner-internal `park`. */
export type ResponderOutcome = PermissionDecision | "park";

export type ClientToolOutcome = "deny" | "park" | { output: unknown };

/** A permission gate raised by the harness, normalized from the ACP request. */
export interface PermissionRequest {
  /** The ACP permission id; reused as the `interaction_request` event id for reply matching. */
  id: string;
  /** Replies the harness offers (e.g. "always" | "once" | "reject"). */
  availableReplies: string[];
  /** The original ACP request, for responders that want the tool-call detail. */
  raw?: unknown;
}

export interface ClientToolRequest {
  /** Reused as the `interaction_request` event id for reply matching. */
  id: string;
  toolCallId?: string;
  toolName?: string;
  input?: unknown;
  raw?: unknown;
}

/**
 * One browser-fulfilled client-tool call presented to a relay. The relay decides whether to park
 * it (cross-turn round-trip), deny it, or resolve it from a stored browser output.
 *
 * This contract lives here (not in `tools/relay.ts`) so the Claude MCP delivery path
 * (`tools/tool-mcp-http.ts`) can park a client tool WITHOUT importing the Daytona file-relay
 * module. Both delivery paths build the same relay via `engines/sandbox_agent/client-tools.ts`.
 */
export interface ClientToolRelayRequest {
  id: string;
  toolCallId: string;
  toolName: string;
  input: unknown;
  spec: ResolvedToolSpec;
}
export interface ClientToolRelay {
  onClientTool: (request: ClientToolRelayRequest) => Promise<ClientToolOutcome>;
  onPark?: (request: ClientToolRelayRequest) => void;
}

/**
 * Answers interaction requests the harness raises. Permission is the only kind wired today;
 * `input` (elicitation) and `client_tool` are forward-looking and will extend this interface
 * alongside the cross-turn responder.
 */
export interface Responder {
  onPermission(request: PermissionRequest): Promise<ResponderOutcome>;
  onClientTool(request: ClientToolRequest): Promise<ClientToolOutcome>;
}

/** Headless responder: a fixed policy, no human in the loop. Never parks (no human surface). */
export class PolicyResponder implements Responder {
  constructor(private readonly policy: PermissionPolicy) {}

  async onPermission(_request: PermissionRequest): Promise<ResponderOutcome> {
    return this.policy === "deny" ? "deny" : "allow";
  }

  async onClientTool(_request: ClientToolRequest): Promise<ClientToolOutcome> {
    return "deny";
  }
}

/**
 * A lookup of approval decisions the user already made on a prior turn, keyed by an
 * identifier carried on the permission request. Two keys are indexed per decision:
 *
 *   1. `toolCallId` — the precise, warm match. When the harness re-presents the SAME ACP
 *      tool-call id (same session), this resolves the exact parked call.
 *   2. `parkedCallKey(name, input)` — the cold-replay anchor. A cold-replayed run rebuilds the
 *      session from the replayed transcript and mints a FRESH tool-call id for the re-raised
 *      gate, so the id no longer matches. The stable anchor is then the tool's NAME **plus
 *      its arguments**: the resumed call re-derives the same name and the same args, so it
 *      resolves; a DIFFERENT call to the same tool (different args) does NOT, so it re-prompts.
 *
 * Keying by the bare tool NAME alone (the prior behavior) over-authorized: an `allow` on call
 * A auto-approved any later call B to the same tool, even with different/sensitive args — a
 * HITL bypass. Binding the cold-replay key to name + args closes that hole while keeping the
 * legitimate approve -> resume path working (resume re-raises the same name + args).
 */
export type ApprovalDecisions = ReadonlyMap<string, unknown>;

/**
 * Client-tool browser outputs the user already produced on a prior turn, keyed by
 * `parkedCallKey(name, args)` (the cold-replay anchor), with a FIFO LIST per key. This store is
 * SEPARATE from `ApprovalDecisions` for two reasons Codex flagged:
 *
 *   1. No allow/deny coercion. A permission reply is `{approved}` -> `"allow"`/`"deny"`; a client
 *      output is the raw browser result. Sharing one map meant a client output whose value was
 *      literally the string `"allow"`/`"deny"` collided with a permission decision. Here the value
 *      is stored verbatim and `onClientTool` never interprets it as a permission decision.
 *   2. Duplicate calls. A single `Map.set` per key let two identical name+args calls overwrite
 *      each other. A FIFO list lets each identical call consume the next stored output in order.
 */
export type ClientToolOutputs = ReadonlyMap<string, readonly unknown[]>;

/**
 * The cold-replay approval anchor: the tool name bound to its arguments. Resume re-derives
 * the same name + args (matches); a different call to the same tool has different args (no
 * match -> re-prompts).
 *
 * Absent args (null/undefined) normalize to `{}` so a genuine NO-ARG tool still gets a stable
 * key and resumes (its calls have nothing to vary, so sharing a key is the same call). This is
 * a deliberate trade-off over fail-closed: the ACP wire reliably carries `rawInput` and the
 * stored side carries the tool_call `input`, so a tool that takes args reports them on both
 * sides (a different-args call gets a different key). The residual is only if a with-args tool
 * reports empty on BOTH sides — then two such calls collide, which the reliable arg capture
 * makes a non-issue.
 *
 * Returns `undefined` (NO key, fail closed -> re-prompt) only when there is no tool name, or
 * the args are not plain JSON (bigint / cycle / NaN/Infinity / non-plain object like Date/Map).
 */
export function parkedCallKey(
  toolName: string | undefined,
  input: unknown,
): string | undefined {
  if (!toolName) return undefined;
  const args = input === null || input === undefined ? {} : input;
  const hash = stableArgsHash(args);
  if (hash === undefined) return undefined; // non-JSON args -> fail closed (no key, re-prompt)
  return `${toolName}#${hash}`;
}

/**
 * Order-independent, stable serialization of tool args so the same call hashes the same.
 * Returns `undefined` for any value that is not plain JSON (bigint, cycles, NaN/Infinity, or
 * a non-plain object like Date/Map) so the caller can fail closed rather than collide. Tool
 * args arrive as JSON over the wire, so this only triggers on a malformed/hostile payload.
 */
function stableArgsHash(input: unknown): string | undefined {
  try {
    return canonicalJson(input);
  } catch {
    return undefined;
  }
}

function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) throw new Error("undefined is not JSON");
  if (typeof value === "bigint") throw new Error("bigint is not JSON");
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("non-finite number is not JSON");
    return JSON.stringify(value);
  }
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  // Only plain objects are stable JSON; reject Date/Map/Set/etc. so they don't collapse to {}.
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    throw new Error("non-plain object is not JSON");
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

/**
 * The cross-turn human-in-the-loop responder for the `/messages` path.
 *
 * It answers a permission gate three ways, in order:
 *   1. The user already decided (a stored `decisions` entry for this exact tool-call id, or
 *      for this tool's name + args) -> apply it. THIS IS THE RESUME PATH: turn N parks, turn
 *      N+1 carries the reply. The match is scoped to the SPECIFIC call (id, or name + args),
 *      never to all future calls of the tool by name, so an `allow` cannot leak to a later
 *      call with different args.
 *   2. No stored decision and there is a human surface (`hasHumanSurface`) -> `park`. The
 *      `interaction_request` was already emitted upstream (the FE prompts), so the turn ends
 *      with this tool PENDING and NO harness reply (the adapter skips `respondPermission`).
 *      A later turn carrying the decision resolves it via branch 1. Parking by `deny` instead
 *      would make Claude emit a failed tool call that clobbers the approval prompt (F-024).
 *   3. No stored decision and no human surface (headless `/invoke`) -> the `basePolicy`
 *      decision. This branch is byte-identical to `PolicyResponder`, so `/invoke` is unchanged
 *      (it never parks; there is no human to resolve a parked turn).
 *
 * Pure: every input (decisions, base policy, surface flag) is injected; no I/O.
 */
export class HITLResponder implements Responder {
  /** Per-key FIFO cursor: how many outputs under a key this turn has already consumed. */
  private readonly clientOutputCursor = new Map<string, number>();

  constructor(
    private readonly decisions: ApprovalDecisions,
    private readonly clientOutputs: ClientToolOutputs,
    private readonly basePolicy: PermissionPolicy,
    private readonly hasHumanSurface: boolean,
  ) {
    hitlDebug(
      `responder built: hasHumanSurface=${hasHumanSurface} basePolicy=${basePolicy} ` +
        `storedDecisionKeys=${JSON.stringify([...decisions.keys()])} ` +
        `clientOutputKeys=${JSON.stringify([...clientOutputs.keys()])}`,
    );
  }

  async onPermission(request: PermissionRequest): Promise<ResponderOutcome> {
    const stored = this.lookupPermission(request);
    if (stored) return stored;
    if (this.hasHumanSurface) return "park"; // human must decide; end the turn, tool pending
    return this.basePolicy === "deny" ? "deny" : "allow"; // headless: PolicyResponder parity
  }

  async onClientTool(request: ClientToolRequest): Promise<ClientToolOutcome> {
    const stored = this.takeClientOutput(request);
    if (stored.found) return { output: stored.output };
    if (this.hasHumanSurface) return "park";
    return "deny";
  }

  private lookupPermission(request: PermissionRequest): PermissionDecision | undefined {
    const liveKeys = permissionRequestKeys(request);
    for (const key of liveKeys) {
      const decision = this.decisions.get(key);
      if (isPermissionDecision(decision)) {
        hitlDebug(`permission RESOLVED on key=${JSON.stringify(key)} -> ${decision}`);
        return decision;
      }
    }
    hitlDebug(
      `permission RE-PARK (no key match): liveKeys=${JSON.stringify(liveKeys)} ` +
        `storedKeys=${JSON.stringify([...this.decisions.keys()])}`,
    );
    return undefined;
  }

  /**
   * Consume the next FIFO browser output for this call from the separate client-output store.
   * Two identical name+args calls each take the next stored output in order (instead of one
   * overwriting the other); a client output is returned verbatim and never read as a permission
   * decision (that store is `decisions`, consulted only by `onPermission`).
   */
  private takeClientOutput(request: ClientToolRequest): { found: boolean; output?: unknown } {
    const liveKeys = clientToolRequestKeys(request);
    for (const key of liveKeys) {
      const list = this.clientOutputs.get(key);
      if (!list || list.length === 0) continue;
      const consumed = this.clientOutputCursor.get(key) ?? 0;
      if (consumed < list.length) {
        this.clientOutputCursor.set(key, consumed + 1);
        hitlDebug(
          `clientTool RESOLVED on key=${JSON.stringify(key)} (output ${consumed + 1}/${list.length})`,
        );
        return { found: true, output: list[consumed] };
      }
    }
    hitlDebug(
      `clientTool RE-PARK (no key match): liveKeys=${JSON.stringify(liveKeys)} ` +
        `storedKeys=${JSON.stringify([...this.clientOutputs.keys()])}`,
    );
    return { found: false };
  }
}

/**
 * The identifiers a stored decision may be keyed by: the gated tool-call id (precise/warm),
 * then the tool name bound to its args (the cold-replay anchor). NOTE: bare name is NOT a key
 * — that would auto-approve any later call to the same tool regardless of args (a HITL
 * bypass). The name is read off the ACP `ToolCallUpdate`, which carries `title`/`kind` (no
 * `name` field on the live wire); the args come from `rawInput` (falling back to `input` for
 * non-ACP shapes / tests).
 */
function permissionRequestKeys(request: PermissionRequest): string[] {
  const keys: string[] = [];
  const raw = request.raw as
    | {
        toolCall?: {
          toolCallId?: unknown;
          name?: unknown;
          title?: unknown;
          kind?: unknown;
          rawInput?: unknown;
          input?: unknown;
        };
      }
    | undefined;
  const toolCall = raw?.toolCall;
  const toolCallId = toolCall?.toolCallId;
  if (typeof toolCallId === "string" && toolCallId) keys.push(toolCallId);
  const name = permissionToolName(toolCall);
  const argsKey = parkedCallKey(name, toolCall?.rawInput ?? toolCall?.input);
  if (argsKey) keys.push(argsKey);
  return keys;
}

function clientToolRequestKeys(request: ClientToolRequest): string[] {
  const keys: string[] = [];
  if (request.toolCallId) keys.push(request.toolCallId);
  const argsKey = parkedCallKey(request.toolName, request.input);
  if (argsKey) keys.push(argsKey);
  return keys;
}

/** Resolve the gated tool's name the same way the egress does: name, then title, then kind. */
function permissionToolName(toolCall: unknown): string | undefined {
  const tc = toolCall as
    | { name?: unknown; title?: unknown; kind?: unknown }
    | undefined;
  for (const candidate of [tc?.name, tc?.title, tc?.kind]) {
    if (typeof candidate === "string" && candidate) return candidate;
  }
  return undefined;
}

/**
 * Build the approval-decision lookup from the inbound run request's message history.
 *
 * The signal is the converted approval reply that the Vercel adapter
 * (`_approval_response_blocks`) produces: a `tool_result` content block keyed by `toolCallId`
 * whose `output` is an `{ approved: boolean }` envelope. That envelope shape is unique to an
 * approval response (an ordinary tool result carries the tool's real output, not an `approved`
 * flag), so no new wire carrier is needed.
 *
 * Each decision is indexed ONLY by `parkedCallKey(name, args)` — the cold-replay anchor. The
 * name/args are recovered from the matching `tool_call` block (same `toolCallId`) the egress
 * folds into the transcript.
 *
 * Two keys deliberately do NOT appear:
 *   - The bare tool NAME — keying by name alone let an `allow` on one call auto-approve every
 *     later call to that tool, even with different args (the HITL bypass this fix closes).
 *   - The historical `toolCallId` — the `/messages` path is always cold-replay (a fresh
 *     session per turn, prior calls replayed as text), so the harness mints a NEW id for the
 *     re-raised gate and a stored historical id can never LEGITIMATELY match it. Keeping it
 *     would only add an args-blind match risk if a fresh id ever collided with a historical
 *     one. So we drop it: the cross-turn match is name + args, never a replayed id.
 */
export function extractApprovalDecisions(
  request: AgentRunRequest,
): Map<string, unknown> {
  const decisions = new Map<string, unknown>();
  const callShapeById = buildCallShapeIndex(request);
  hitlDebug(
    `extract approvals: scanned ${request.messages?.length ?? 0} messages, ` +
      `callShapeById ids=${JSON.stringify([...callShapeById.keys()])}`,
  );
  for (const block of toolResultBlocks(request)) {
    // ONLY approval-envelope (`{approved}`) results land here; a client-tool's raw browser
    // output goes to the separate `extractClientToolOutputs` store (so a client output literally
    // `"allow"`/`"deny"` can never be mis-read as a permission decision).
    const decision = approvalDecisionOf(block);
    if (decision === undefined) continue;
    const argsKey = coldReplayKey(block, callShapeById);
    if (argsKey) {
      decisions.set(argsKey, decision);
      hitlDebug(
        `extract: stored decision key=${JSON.stringify(argsKey)} -> ${decision}`,
      );
    }
  }
  return decisions;
}

/**
 * Build the client-tool output store from the inbound history: every NON-approval `tool_result`
 * is a browser-fulfilled client-tool output. Keyed by the cold-replay anchor `parkedCallKey(name,
 * args)`, with a FIFO LIST per key so two identical calls each resolve from the next stored
 * output instead of one overwriting the other. The value is the raw output, never coerced.
 *
 * (A normal callback/code tool result also lands here, but is harmless: `onClientTool` only fires
 * for `kind: "client"` tools, and a resolved callback tool is not re-called as a client park.)
 */
export function extractClientToolOutputs(
  request: AgentRunRequest,
): Map<string, unknown[]> {
  const outputs = new Map<string, unknown[]>();
  const callShapeById = buildCallShapeIndex(request);
  for (const block of toolResultBlocks(request)) {
    if (approvalDecisionOf(block) !== undefined) continue; // an approval, not a client output
    const argsKey = coldReplayKey(block, callShapeById);
    if (!argsKey) continue;
    const list = outputs.get(argsKey) ?? [];
    list.push(block.output);
    outputs.set(argsKey, list);
    hitlDebug(
      `extract: stored client output key=${JSON.stringify(argsKey)} (${list.length} queued)`,
    );
  }
  return outputs;
}

/** Recover each tool call's name + args keyed by its id, so a reply that carries only the id
 * (e.g. an `{approved}` envelope) can be bound to the cold-replay name+args anchor. */
function buildCallShapeIndex(
  request: AgentRunRequest,
): Map<string, { name?: string; input?: unknown }> {
  const index = new Map<string, { name?: string; input?: unknown }>();
  for (const message of request.messages ?? []) {
    const content = message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block?.type === "tool_call" && block.toolCallId) {
        index.set(block.toolCallId, { name: block.toolName, input: block.input });
      }
    }
  }
  return index;
}

/** Every `tool_result` content block across the run's message history. */
function* toolResultBlocks(request: AgentRunRequest): Generator<ContentBlock> {
  for (const message of request.messages ?? []) {
    const content = message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block?.type === "tool_result") yield block;
    }
  }
}

/** The cold-replay name+args key for a tool_result, recovering name/args from the correlated
 * tool_call block when the result block itself carries only an id. Never a bare name or an id. */
function coldReplayKey(
  block: ContentBlock,
  callShapeById: Map<string, { name?: string; input?: unknown }>,
): string | undefined {
  const shape = block.toolCallId ? callShapeById.get(block.toolCallId) : undefined;
  const name = block.toolName ?? shape?.name;
  const input = block.input ?? shape?.input;
  return parkedCallKey(name, input);
}

function isPermissionDecision(value: unknown): value is PermissionDecision {
  return value === "allow" || value === "deny";
}

/**
 * An approval reply uses an `{ approved: boolean }` envelope (the Vercel adapter's
 * `_approval_response_blocks` shape), unique to a permission response. Returns `"allow"`/`"deny"`
 * for one, or `undefined` for any other tool_result (a real browser/client output).
 */
function approvalDecisionOf(block: ContentBlock): PermissionDecision | undefined {
  if (!block || block.type !== "tool_result") return undefined;
  const output = block.output;
  if (
    output &&
    typeof output === "object" &&
    !Array.isArray(output) &&
    typeof (output as { approved?: unknown }).approved === "boolean"
  ) {
    return (output as { approved: boolean }).approved ? "allow" : "deny";
  }
  return undefined;
}

/**
 * Resolve the permission policy with the same precedence as before: an explicit per-run
 * `permissionPolicy: "deny"` or the `SANDBOX_AGENT_DENY_PERMISSIONS` env flips to deny; the
 * default is auto-allow, because backend-resolved tools are trusted and the run is headless.
 */
export function policyFromRequest(permissionPolicy?: string): PermissionPolicy {
  if (
    permissionPolicy === "deny" ||
    process.env.SANDBOX_AGENT_DENY_PERMISSIONS === "true"
  ) {
    return "deny";
  }
  return "auto";
}

/**
 * Map an allow/deny decision onto the harness's available ACP replies.
 *
 * An `allow` maps to `"once"` (grant THIS call only), NOT `"always"`. `"always"` tells the
 * harness to allow the tool broadly for the rest of the turn WITHOUT re-raising the gate, so a
 * single approval of call A would silently authorize later calls to the same tool without
 * rechecking name + args — re-opening the over-authorization hole this module closes. Every
 * call must be gated individually; the headless auto-allow policy already returns `allow` per
 * call, so `"once"` per call is equivalent for it and strictly safer for HITL.
 */
export function decisionToReply(
  decision: PermissionDecision,
  availableReplies: string[],
): string {
  if (decision === "deny") {
    return availableReplies.find((r) => r === "reject") ?? "reject";
  }
  return availableReplies.find((r) => r === "once") ?? "once";
}
