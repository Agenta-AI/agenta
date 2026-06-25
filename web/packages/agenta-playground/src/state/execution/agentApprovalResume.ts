/**
 * Agent-lane HITL resume predicate.
 *
 * `useChat`'s `sendAutomaticallyWhen` decides when the conversation auto-resends after the
 * user resolves a tool-approval gate. The AI SDK ships
 * `lastAssistantMessageIsCompleteWithApprovalResponses`, which DOES fire for a deny-only
 * decision (a denied tool part is still `approval-responded`). We wrap it in an explicit,
 * unit-tested predicate so the deny → resume contract is pinned at the FE seam rather than
 * left implicit in the SDK internals:
 *
 *   - Approve and Deny BOTH resume. On resume the runner receives the `{approved}` envelope
 *     (the SDK ingress maps an `approval-responded` tool part to a `tool_result`), maps a
 *     deny to reject → tool-error, and the model continues — no deadlock, no limbo
 *     `approval-responded` state (the F-036 dead-end).
 *   - A pending gate (`approval-requested`, still awaiting the user) does NOT resume.
 *
 * Pure + structurally typed so the package needs no `ai` dependency: it reads only the
 * fields the AI SDK puts on a UI message (`role`, `parts[].type/state/approval`).
 */

interface ApprovalLike {
    approved?: boolean
}

interface ToolPartLike {
    type?: string
    state?: string
    providerExecuted?: boolean
    approval?: ApprovalLike
}

interface MessageLike {
    role?: string
    parts?: ToolPartLike[]
}

const isToolPart = (part: ToolPartLike): boolean => {
    const type = part?.type
    return typeof type === "string" && (type.startsWith("tool-") || type === "dynamic-tool")
}

/** A tool part the user has resolved (approve OR deny) on this turn. */
const isRespondedToolPart = (part: ToolPartLike): boolean =>
    isToolPart(part) && part.state === "approval-responded"

/** A resolved tool part is settled when it has run, errored, or carries a decision. */
const isSettledToolPart = (part: ToolPartLike): boolean =>
    isToolPart(part) &&
    (part.state === "output-available" ||
        part.state === "output-error" ||
        part.state === "approval-responded")

/**
 * Resume when the last assistant turn carries at least one responded approval and EVERY
 * non-provider-executed tool part on it is settled. Deny-only counts: a denied tool part is
 * `approval-responded`, so a turn the user only denied still resumes and the runner gets the
 * denial round-trip (the fix for the deny dead-end).
 */
export function agentShouldResumeAfterApproval({messages}: {messages: MessageLike[]}): boolean {
    const last = messages[messages.length - 1]
    if (!last || last.role !== "assistant") return false

    const toolParts = (last.parts ?? []).filter(
        (part) => isToolPart(part) && part.providerExecuted !== true,
    )
    if (toolParts.length === 0) return false

    const hasResponded = toolParts.some(isRespondedToolPart)
    const allSettled = toolParts.every(isSettledToolPart)
    return hasResponded && allSettled
}
