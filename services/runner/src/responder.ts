/**
 * The interaction responder seam.
 *
 * Harness permission gates and browser-fulfilled client tools are normalized into
 * `GateDescriptor`s before they reach this module. The responder decides from the shared
 * permission plan; adapters decide how to express each verdict on their own wire.
 */

import type { AgentRunRequest, ContentBlock } from "./protocol.ts";
import {
  decide,
  effectivePermission,
  storedDecisionKeyShape,
  type GateDescriptor,
  type PermissionPlan,
  type StoredPermissionDecisions,
  type Verdict,
} from "./permission-plan.ts";

export type PermissionDecision = "allow" | "deny";

export type ClientToolOutcome =
  "deny" | "pendingApproval" | { output: unknown };

/** A permission gate raised by the harness, normalized from the ACP request. */
export interface PermissionGateRequest {
  id: string;
  availableReplies: string[];
  gate: GateDescriptor;
  raw?: unknown;
}

export interface ClientToolGateRequest {
  id: string;
  toolCallId?: string;
  gate: GateDescriptor;
  raw?: unknown;
}

export type ClientToolVerdict =
  | { kind: "deny" }
  | { kind: "pendingApproval" }
  | { kind: "fulfilled"; output: unknown };

/** Answers interaction requests the harness raises. */
export interface Responder {
  onPermission(request: PermissionGateRequest): Promise<Verdict>;
  onClientTool(
    request: ClientToolGateRequest,
    opts?: { consume?: boolean },
  ): Promise<ClientToolVerdict>;
}

export type ApprovalDecisions = ReadonlyMap<string, unknown>;

/**
 * The cold-replay approval anchor: the tool name bound to its arguments. Resume re-derives
 * the same name + args (matches); a different call to the same tool has different args (no
 * match -> pauses for a new decision).
 *
 * Absent args (null/undefined) normalize to `{}` so a genuine no-arg tool still gets a stable
 * key and resumes. Returns `undefined` only when there is no tool name, or the args are not
 * plain JSON (bigint / cycle / NaN/Infinity / non-plain object like Date/Map).
 */
export function approvedCallKey(
  toolName: string | undefined,
  input: unknown,
): string | undefined {
  const shape = storedDecisionKeyShape(toolName, input);
  if (!shape.toolName) return undefined;
  const args =
    shape.args === null || shape.args === undefined ? {} : shape.args;
  const hash = stableArgsHash(args);
  if (hash === undefined) return undefined;
  return `${shape.toolName}#${hash}`;
}

/**
 * Order-independent, stable serialization of tool args so the same call hashes the same.
 * Returns `undefined` for any value that is not plain JSON so the caller can fail closed
 * rather than collide.
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
    if (!Number.isFinite(value))
      throw new Error("non-finite number is not JSON");
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
 * Client-tool browser outputs the user already produced on a prior turn, keyed by
 * `approvedCallKey(name, args)` (the cold-replay anchor), with a FIFO LIST per key. This store
 * is SEPARATE from the approval-decision map for two reasons Codex flagged:
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
 * Consume-once store of approvals/denials and client-tool outputs carried in the replayed
 * conversation.
 *
 * Client-tool outputs are consume-once per fulfillment: the ACP gate only peeks to prove an
 * output exists, and the relay consumes when it actually serves that output to the tool child.
 * Two identical client-tool calls in one conversation each resolve from the next stored output
 * under the shared key (FIFO), so neither overwrites the other.
 */
export class ConversationDecisions implements StoredPermissionDecisions {
  /** Per-key FIFO cursor: how many outputs under a key this conversation already consumed. */
  private readonly clientOutputCursor = new Map<string, number>();

  constructor(
    private readonly byKey: Map<string, unknown>,
    private readonly clientOutputs: ClientToolOutputs = new Map(),
  ) {}

  /** allow|deny for this exact call (name + canonical args), consumed on first take. */
  take(gate: GateDescriptor): "allow" | "deny" | undefined {
    const key = approvedCallKey(gate.toolName, gate.args);
    if (!key || !this.byKey.has(key)) return undefined;
    const value = this.byKey.get(key);
    if (!isPermissionDecision(value)) return undefined;
    this.byKey.delete(key);
    return value;
  }

  /** The next FIFO client-tool output for this exact call, without consuming it. */
  peekClientOutput(gate: GateDescriptor): { found: boolean; output?: unknown } {
    const entry = this.nextClientOutput(gate);
    return entry ? { found: true, output: entry.output } : { found: false };
  }

  /** The next FIFO client-tool output for this exact call, consumed on take. */
  takeClientOutput(gate: GateDescriptor): { found: boolean; output?: unknown } {
    const entry = this.nextClientOutput(gate);
    if (!entry) return { found: false };
    this.clientOutputCursor.set(entry.key, entry.consumed + 1);
    return { found: true, output: entry.output };
  }

  /** The next unconsumed output under this call's key, or undefined when exhausted/absent. */
  private nextClientOutput(
    gate: GateDescriptor,
  ): { key: string; consumed: number; output: unknown } | undefined {
    const key = approvedCallKey(gate.toolName, gate.args);
    if (!key) return undefined;
    const list = this.clientOutputs.get(key);
    if (!list || list.length === 0) return undefined;
    const consumed = this.clientOutputCursor.get(key) ?? 0;
    if (consumed >= list.length) return undefined;
    return { key, consumed, output: list[consumed] };
  }
}

/**
 * Shared approval responder for ACP permission gates and client tools.
 *
 * Permission gates use the shared `decide()` ladder directly. Client tools are different only
 * in execution shape: `allow` and `ask` both mean "forward to the browser and pause unless a
 * stored browser output is already available"; `deny` refuses the call.
 */
export class ApprovalResponder implements Responder {
  constructor(
    private readonly plan: PermissionPlan,
    private readonly decisions: ConversationDecisions,
    private readonly log: (msg: string) => void = () => {},
  ) {}

  async onPermission(request: PermissionGateRequest): Promise<Verdict> {
    const permission = effectivePermission(request.gate, this.plan);
    const verdict = decide(request.gate, this.plan, this.decisions);
    this.log(
      `[HITL] gate toolName=${JSON.stringify(request.gate.toolName)} ` +
        `permission=${permission} outcome=${verdict.kind}`,
    );
    return verdict;
  }

  async onClientTool(
    request: ClientToolGateRequest,
    opts: { consume?: boolean } = {},
  ): Promise<ClientToolVerdict> {
    const storedOutput = opts.consume
      ? this.decisions.takeClientOutput(request.gate)
      : this.decisions.peekClientOutput(request.gate);
    if (storedOutput.found) {
      return { kind: "fulfilled", output: storedOutput.output };
    }

    const permission =
      request.gate.specPermission ??
      (this.plan.default === "deny" ? "deny" : "allow");
    if (permission === "deny") return { kind: "deny" };

    if (permission === "ask") {
      const storedDecision = this.decisions.take(request.gate);
      if (storedDecision === "deny") return { kind: "deny" };
    }
    return { kind: "pendingApproval" };
  }
}

/**
 * Build the approval-decision lookup from the inbound run request's message history.
 *
 * The signal is the converted approval reply that the Vercel adapter produces: a
 * `tool_result` content block keyed by `toolCallId` whose `output` is an `{ approved:
 * boolean }` envelope. Each decision is indexed only by `approvedCallKey(name, args)` - the
 * cold-replay anchor. The name/args are recovered from the matching `tool_call` block (same
 * `toolCallId`) the egress folds into the transcript. An unbindable approval envelope is
 * dropped; the gate re-raises and re-prompts, never guessed.
 *
 * ONLY approval-envelope (`{approved}`) results land here; a client-tool's raw browser output
 * goes to the separate `extractClientToolOutputs` store (so a client output literally
 * `"allow"`/`"deny"` can never be mis-read as a permission decision).
 */
export function extractApprovalDecisions(
  request: AgentRunRequest,
): Map<string, unknown> {
  const decisions = new Map<string, unknown>();
  const callShapeById = buildCallShapeIndex(request);
  for (const block of toolResultBlocks(request)) {
    const decision = approvalDecisionOf(block);
    if (decision === undefined) continue;
    const argsKey = coldReplayKey(block, callShapeById);
    if (argsKey) decisions.set(argsKey, decision);
  }
  return decisions;
}

/**
 * Build the client-tool output store from the inbound history: every NON-approval `tool_result`
 * is a browser-fulfilled client-tool output. Keyed by the cold-replay anchor
 * `approvedCallKey(name, args)`, with a FIFO LIST per key so two identical calls each resolve
 * from the next stored output instead of one overwriting the other. The value is the raw
 * output, never coerced.
 *
 * (A normal callback/code tool result also lands here, but is harmless: `onClientTool` only
 * fires for `kind: "client"` tools, and a resolved callback tool is not re-called as a client
 * pause.)
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
        index.set(block.toolCallId, {
          name: block.toolName,
          input: block.input,
        });
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
  const shape = block.toolCallId
    ? callShapeById.get(block.toolCallId)
    : undefined;
  const name = block.toolName ?? shape?.name;
  const input = block.input ?? shape?.input;
  return approvedCallKey(name, input);
}

function isPermissionDecision(value: unknown): value is PermissionDecision {
  return value === "allow" || value === "deny";
}

/**
 * An approval reply uses an `{ approved: boolean }` envelope (the Vercel adapter's
 * `_approval_response_blocks` shape), unique to a permission response. Returns
 * `"allow"`/`"deny"` for one, or `undefined` for any other tool_result (a real browser/client
 * output).
 */
function approvalDecisionOf(
  block: ContentBlock,
): PermissionDecision | undefined {
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
 * Map an allow/deny decision onto the harness's available ACP replies.
 *
 * An `allow` maps to `"once"` (grant THIS call only), NOT `"always"`. `"always"` tells the
 * harness to allow the tool broadly for the rest of the turn WITHOUT re-raising the gate, so
 * a single approval of call A would silently authorize later calls to the same tool without
 * rechecking name + args. Every call must be gated individually; the headless auto-allow
 * policy already returns `allow` per call, so `"once"` per call is equivalent for it and
 * strictly safer for HITL.
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
