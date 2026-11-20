/**
 * The decision map a gate receives when the session's interaction rows hold these answers.
 *
 * Production takes an approval decision only from a `responded` row (`TurnApprovalRows`), never
 * from message text. Gate tests only need "this call was answered allow/deny", so they write the
 * answers as approval envelopes beside the calls, and this helper turns each one into the entry
 * its row would give: keyed by the call's name and arguments, in message order.
 */
import type { AgentRunRequest, ContentBlock } from "../../src/protocol.ts";
import {
  buildCallShapeIndex,
  coldReplayKey,
  approvalEnvelopeOf,
} from "../../src/responder.ts";
import {
  TurnApprovalRows,
  type InteractionRow,
} from "../../src/sessions/interactions.ts";

export function answeredDecisions(
  request: Pick<AgentRunRequest, "messages">,
): Map<string, unknown[]> {
  const decisions = new Map<string, unknown[]>();
  const callShapeById = buildCallShapeIndex(request.messages);
  for (const message of request.messages ?? []) {
    if (!Array.isArray(message?.content)) continue;
    for (const block of message.content as ContentBlock[]) {
      if (block?.type !== "tool_result") continue;
      const decision = approvalEnvelopeOf(block);
      if (decision === undefined) continue;
      const key = coldReplayKey(block, callShapeById);
      if (!key) continue;
      const list = decisions.get(key) ?? [];
      list.push(decision);
      decisions.set(key, list);
    }
  }
  return decisions;
}

/**
 * The rows a person's answers leave on the interactions plane: one `responded` row per approval
 * envelope in the request, under the envelope's token, for the call the envelope answers. The
 * claim always succeeds. Production reads these rows from the API (`loadTurnApprovalRows`).
 */
export function personAnsweredRows(
  request: Pick<AgentRunRequest, "messages">,
): TurnApprovalRows {
  const callShapeById = buildCallShapeIndex(request.messages);
  const rows: InteractionRow[] = [];
  for (const message of request.messages ?? []) {
    if (!Array.isArray(message?.content)) continue;
    for (const block of message.content as ContentBlock[]) {
      if (block?.type !== "tool_result") continue;
      const envelope = approvalEnvelopeOf(block);
      if (!envelope?.interactionToken) continue;
      const shape = block.toolCallId
        ? callShapeById.get(block.toolCallId)
        : undefined;
      rows.push({
        token: envelope.interactionToken,
        kind: "user_approval",
        status: "responded",
        data: {
          request: {
            tool: block.toolName ?? shape?.name ?? "",
            args: block.input ?? shape?.input ?? {},
          },
          resolution: { approved: envelope.decision === "allow" },
        },
      });
    }
  }
  return new TurnApprovalRows(rows, async () => true);
}
