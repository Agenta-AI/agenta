import type { AgentEvent } from "../../protocol.ts";
import { decisionToReply, type Responder } from "../../responder.ts";

export interface AttachPermissionResponderInput {
  session: any;
  run: { emitEvent: (event: AgentEvent) => void };
  responder: Responder;
}

/**
 * Wire ACP permission reverse-RPC into the runner's event stream and responder policy.
 *
 * The default engine responder is headless today, but this boundary keeps future cross-turn
 * human approval from changing the sandbox-agent session plumbing.
 */
export function attachPermissionResponder({
  session,
  run,
  responder,
}: AttachPermissionResponderInput): void {
  session.onPermissionRequest((req: any) => {
    const id = String(req?.id ?? "");
    const availableReplies: string[] = req?.availableReplies ?? [];
    run.emitEvent({
      type: "interaction_request",
      id, // ACP permission id -> Vercel approvalId
      kind: "permission",
      payload: {
        // toolCallId of the gated tool, so the cross-turn approval reply correlates back to
        // its tool call (and the #6 resume finds it). `toolCall` is the ACP ToolCallUpdate.
        toolCallId: req?.toolCall?.toolCallId,
        toolCall: req?.toolCall,
        availableReplies,
        options: req?.options,
      },
    });
    void responder
      .onPermission({ id, availableReplies, raw: req })
      .then((decision) => {
        if (!req?.id) return;
        // PARK (cross-turn HITL): send NO reply. The `interaction_request` above is the last
        // word on this tool call; the harness ends the turn with the tool PENDING and the next
        // turn's stored decision resolves it. Replying `reject` here would make Claude emit a
        // failed tool call ("User refused permission") that clobbers the approval prompt on the
        // same tool-call id (F-024) — do NOT map park onto a reply.
        if (decision === "park") return;
        return session.respondPermission(
          req.id,
          decisionToReply(decision, availableReplies) as any,
        );
      })
      .catch(() => {});
  });
}
