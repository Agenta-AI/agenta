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
 *   - A cross-turn responder (the `/messages` HITL path) slots in here later: it surfaces the
 *     request to the browser, ends the turn, and resolves on the next turn's reply. The
 *     harness adapter does not change when the responder does.
 *
 * Resolution is modeled as `allow` / `deny`; the adapter maps that onto the harness's
 * available ACP replies via `decisionToReply`.
 */

export type PermissionPolicy = "auto" | "deny";

export type PermissionDecision = "allow" | "deny";

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
  onPermission(request: PermissionRequest): Promise<PermissionDecision>;
}

/** Headless responder: a fixed policy, no human in the loop. */
export class PolicyResponder implements Responder {
  constructor(private readonly policy: PermissionPolicy) {}

  async onPermission(_request: PermissionRequest): Promise<PermissionDecision> {
    return this.policy === "deny" ? "deny" : "allow";
  }
}

/**
 * Resolve the permission policy with the same precedence as before: an explicit per-run
 * `permissionPolicy: "deny"` or the `SANDBOX_AGENT_DENY_PERMISSIONS` env flips to deny; the
 * default is auto-allow, because backend-resolved tools are trusted and the run is headless.
 */
export function policyFromRequest(permissionPolicy?: string): PermissionPolicy {
  if (permissionPolicy === "deny" || process.env.SANDBOX_AGENT_DENY_PERMISSIONS === "true") {
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
