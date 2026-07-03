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
  type GateDescriptor,
  type PermissionPlan,
  type StoredPermissionDecisions,
  type Verdict,
} from "./permission-plan.ts";

export type PermissionDecision = "allow" | "deny";

// phase 2b deletes this (relay still consumes it)
export type PermissionPolicy = "auto" | "deny";

// phase 2b deletes this relay vocabulary when `tools/relay.ts` is rewritten.
export type ClientToolOutcome = "deny" | "park" | { output: unknown };

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
  onClientTool(request: ClientToolGateRequest): Promise<ClientToolVerdict>;
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
  if (!toolName) return undefined;
  const args = input === null || input === undefined ? {} : input;
  const hash = stableArgsHash(args);
  if (hash === undefined) return undefined;
  return `${toolName}#${hash}`;
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

/** Consume-once store of approvals/denials carried in the replayed conversation. */
export class ConversationDecisions implements StoredPermissionDecisions {
  constructor(private readonly byKey: Map<string, unknown>) {}

  /** allow|deny for this exact call (name + canonical args), consumed on first take. */
  take(gate: GateDescriptor): "allow" | "deny" | undefined {
    const key = approvedCallKey(gate.toolName, gate.args);
    if (!key || !this.byKey.has(key)) return undefined;
    const value = this.byKey.get(key);
    if (!isPermissionDecision(value)) return undefined;
    this.byKey.delete(key);
    return value;
  }

  /** A client-tool fulfillment output for this exact call, consumed on first take. */
  takeClientOutput(gate: GateDescriptor): { found: boolean; output?: unknown } {
    const key = approvedCallKey(gate.toolName, gate.args);
    if (!key || !this.byKey.has(key)) return { found: false };
    const value = this.byKey.get(key);
    if (isPermissionDecision(value)) return { found: false };
    this.byKey.delete(key);
    return { found: true, output: value };
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

  async onClientTool(request: ClientToolGateRequest): Promise<ClientToolVerdict> {
    const storedOutput = this.decisions.takeClientOutput(request.gate);
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
 * `toolCallId`) the egress folds into the transcript.
 */
export function extractApprovalDecisions(
  request: AgentRunRequest,
): Map<string, unknown> {
  const decisions = new Map<string, unknown>();
  const callShapeById = new Map<string, { name?: string; input?: unknown }>();
  for (const message of request.messages ?? []) {
    const content = message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block?.type === "tool_call" && block.toolCallId) {
        callShapeById.set(block.toolCallId, {
          name: block.toolName,
          input: block.input,
        });
      }
    }
  }
  for (const message of request.messages ?? []) {
    const content = message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      const result = approvedCallResultOf(block);
      if (!result.found) continue;
      const shape = block.toolCallId
        ? callShapeById.get(block.toolCallId)
        : undefined;
      const name = block.toolName ?? shape?.name;
      const input = block.input ?? shape?.input;
      const argsKey = approvedCallKey(name, input);
      if (argsKey) decisions.set(argsKey, result.output);
    }
  }
  return decisions;
}

function isPermissionDecision(value: unknown): value is PermissionDecision {
  return value === "allow" || value === "deny";
}

/**
 * A paused call reply. Permission responses use `{ approved: boolean }`; client tools carry
 * their real structured `output`.
 */
function approvedCallResultOf(block: ContentBlock): { found: boolean; output?: unknown } {
  if (!block || block.type !== "tool_result") return { found: false };
  const output = block.output;
  if (
    output &&
    typeof output === "object" &&
    !Array.isArray(output) &&
    typeof (output as { approved?: unknown }).approved === "boolean"
  ) {
    return {
      found: true,
      output: (output as { approved: boolean }).approved ? "allow" : "deny",
    };
  }
  return { found: true, output };
}

/**
 * Resolve the legacy permission policy with the same precedence as before: an explicit
 * per-run `permissionPolicy: "deny"` or the env override flips to deny; the default is auto.
 */
// phase 2b deletes this (relay still consumes it)
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
