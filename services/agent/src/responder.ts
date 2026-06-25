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

import type { AgentRunRequest, ContentBlock } from "./protocol.ts";

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

/** A permission gate raised by the harness, normalized from the ACP request. */
export interface PermissionRequest {
  /** The ACP permission id; reused as the `interaction_request` event id for reply matching. */
  id: string;
  /** Replies the harness offers (e.g. "always" | "once" | "reject"). */
  availableReplies: string[];
  /** The original ACP request, for responders that want the tool-call detail. */
  raw?: unknown;
}

/**
 * Answers interaction requests the harness raises. Permission is the only kind wired today;
 * `input` (elicitation) and `client_tool` are forward-looking and will extend this interface
 * alongside the cross-turn responder.
 */
export interface Responder {
  onPermission(request: PermissionRequest): Promise<ResponderOutcome>;
}

/** Headless responder: a fixed policy, no human in the loop. Never parks (no human surface). */
export class PolicyResponder implements Responder {
  constructor(private readonly policy: PermissionPolicy) {}

  async onPermission(_request: PermissionRequest): Promise<ResponderOutcome> {
    return this.policy === "deny" ? "deny" : "allow";
  }
}

/**
 * A lookup of approval decisions the user already made on a prior turn, keyed by the
 * identifier carried on the permission request. Both the tool-call id and the tool name are
 * indexed because a cold-replayed run mints fresh ACP permission/tool-call ids each turn, so
 * the stable cross-turn anchor is whichever the harness re-presents. `toolCallId` is the
 * precise match; `toolName` is the fallback when the id was not preserved across the boundary.
 */
export type ApprovalDecisions = ReadonlyMap<string, PermissionDecision>;

/**
 * The cross-turn human-in-the-loop responder for the `/messages` path.
 *
 * It answers a permission gate three ways, in order:
 *   1. The user already decided (a stored `decisions` entry for this tool-call id or tool
 *      name) -> apply it. THIS IS THE RESUME PATH: turn N parks, turn N+1 carries the reply.
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
  constructor(
    private readonly decisions: ApprovalDecisions,
    private readonly basePolicy: PermissionPolicy,
    private readonly hasHumanSurface: boolean,
  ) {}

  async onPermission(request: PermissionRequest): Promise<ResponderOutcome> {
    const stored = this.lookup(request);
    if (stored) return stored;
    if (this.hasHumanSurface) return "park"; // human must decide; end the turn, tool pending
    return this.basePolicy === "deny" ? "deny" : "allow"; // headless: PolicyResponder parity
  }

  private lookup(request: PermissionRequest): PermissionDecision | undefined {
    for (const key of permissionRequestKeys(request)) {
      const decision = this.decisions.get(key);
      if (decision) return decision;
    }
    return undefined;
  }
}

/** The identifiers a stored decision may be keyed by: the gated tool-call id, then its name. */
function permissionRequestKeys(request: PermissionRequest): string[] {
  const keys: string[] = [];
  const raw = request.raw as
    | { toolCall?: { toolCallId?: unknown; name?: unknown } }
    | undefined;
  const toolCallId = raw?.toolCall?.toolCallId;
  if (typeof toolCallId === "string" && toolCallId) keys.push(toolCallId);
  const name = raw?.toolCall?.name;
  if (typeof name === "string" && name) keys.push(name);
  return keys;
}

/**
 * Build the approval-decision lookup from the inbound run request's message history.
 *
 * The signal is the converted approval reply that the Vercel adapter
 * (`_approval_response_blocks`) already produces: a `tool_result` content block keyed by
 * `toolCallId` whose `output` is an `{ approved: boolean }` envelope. That envelope shape is
 * unique to an approval response (an ordinary tool result carries the tool's real output, not
 * an `approved` flag), so no new wire carrier is needed. We index each decision by its
 * `toolCallId` and, when the block also names a tool, by `toolName` (the cross-turn fallback
 * when a cold replay did not preserve the id).
 */
export function extractApprovalDecisions(
  request: AgentRunRequest,
): Map<string, PermissionDecision> {
  const decisions = new Map<string, PermissionDecision>();
  for (const message of request.messages ?? []) {
    const content = message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      const decision = approvalDecisionOf(block);
      if (!decision) continue;
      if (block.toolCallId) decisions.set(block.toolCallId, decision);
      if (block.toolName) decisions.set(block.toolName, decision);
    }
  }
  return decisions;
}

/** A `tool_result` block whose `output` is an `{ approved: boolean }` envelope -> a decision. */
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

/** Map an allow/deny decision onto the harness's available ACP replies. */
export function decisionToReply(
  decision: PermissionDecision,
  availableReplies: string[],
): string {
  if (decision === "deny") {
    return availableReplies.find((r) => r === "reject") ?? "reject";
  }
  return (
    availableReplies.find((r) => r === "always") ??
    availableReplies.find((r) => r === "once") ??
    "once"
  );
}
