import type {UIMessage} from "ai"

/**
 * Stamp approval decisions onto the transcript tail — the exact shape
 * `transcriptToMessages` produces for a replayed `interaction_response`
 * (`state: "approval-responded"`, `approval: {id, approved}`), which the SDK's vercel
 * adapter folds into the `{approved, interactionToken}` tool_result envelope the runner's
 * decision map reads. Returns the SAME array when nothing matched (caller treats that as
 * "gate already gone").
 */
export const stampApprovalResponses = (
    messages: UIMessage[],
    approvalIds: readonly string[],
    approved: boolean,
): UIMessage[] => {
    if (messages.length === 0) return messages
    const tailIndex = messages.length - 1
    const tail = messages[tailIndex]
    if (tail.role !== "assistant") return messages
    const targets = new Set(approvalIds)
    let touched = false
    const parts = (tail.parts ?? []).map((part) => {
        const p = part as {state?: string; approval?: {id?: string}}
        if (p.state === "approval-requested" && p.approval?.id && targets.has(p.approval.id)) {
            touched = true
            return {
                ...part,
                state: "approval-responded",
                approval: {id: p.approval.id, approved},
            } as typeof part
        }
        return part
    })
    if (!touched) return messages
    const next = messages.slice()
    next[tailIndex] = {...tail, parts}
    return next
}
