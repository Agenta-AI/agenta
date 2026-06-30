/**
 * Agent-lane resume predicate — for BOTH parked client tools and HITL approval gates.
 *
 * `useChat`'s `sendAutomaticallyWhen` decides when the conversation auto-resends after a parked
 * client interaction settles. The agent FE round-trip (#4920) generalizes the existing approval
 * round-trip to an arbitrary browser-fulfilled tool: the runner emits the tool call and parks the
 * turn; the playground fulfills it with `addToolOutput`; the turn must then auto-resend so the
 * runner cold-replays and resumes. Two settle shapes drive a resume here:
 *
 *   - **Approval response.** Approve AND Deny both resume — a denied tool part is still
 *     `approval-responded`, so the runner gets the denial round-trip (the SDK ingress maps it to a
 *     `tool_result`, a deny → tool-error) and the model continues. No `approval-responded` limbo
 *     (the F-036 dead-end).
 *   - **Client-tool result.** A parked client tool fulfilled by the browser settles to
 *     `output-available`/`output-error` with `providerExecuted` falsy (it was NOT run server-side).
 *     That fulfilled output must resume the run exactly as an approval does.
 *
 * A pending interaction (`approval-requested`, or a still-`input-available` client tool awaiting the
 * user) does NOT resume. Server-executed tool parts (`providerExecuted === true`) are ignored — they
 * settle within the turn and never park, so they neither gate nor trigger a resume.
 *
 * Pure + structurally typed so the package needs no `ai` dependency: it reads only the fields the AI
 * SDK puts on a UI message (`role`, `parts[].type/state/providerExecuted`).
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

/**
 * A browser-fulfilled client-tool result: a tool part the playground settled via `addToolOutput`
 * (`output-available`/`output-error`) that the server did NOT run (`providerExecuted` falsy) and
 * carries NO approval metadata. This is how a parked `request_connection` (or any client tool) reads
 * once the widget settles it.
 *
 * The `approval == null` guard is load-bearing: an approval-gated tool that was approved and then RAN
 * also lands in `output-available` with `providerExecuted` falsy, but it is NOT a parked client tool
 * (its turn already continued) — it keeps its `approval` field, so excluding it here stops a spurious
 * resume (and stops the queue gate, which composes this predicate, from holding forever). v1 client
 * tools are never approval-gated; an approval-gated client tool would need a richer signal.
 */
const isClientToolResult = (part: ToolPartLike): boolean =>
    isToolPart(part) &&
    part.providerExecuted !== true &&
    part.approval == null &&
    (part.state === "output-available" || part.state === "output-error")

/** A resolved tool part is settled when it has run, errored, or carries a decision. */
const isSettledToolPart = (part: ToolPartLike): boolean =>
    isToolPart(part) &&
    (part.state === "output-available" ||
        part.state === "output-error" ||
        part.state === "approval-responded")

/**
 * Resume when the last assistant turn carries at least one freshly-resolved parked interaction (an
 * approval response OR a browser-fulfilled client-tool result) and EVERY non-provider-executed tool
 * part on it is settled. Both paths share one rule so a single `sendAutomaticallyWhen` covers
 * approvals and client tools alike:
 *   - Approval (approve OR deny): a denied tool part is `approval-responded`, so a deny-only turn
 *     still resumes and the runner gets the denial round-trip (the deny dead-end fix).
 *   - Client tool: a `request_connection` the widget settled (success, cancel, failure, abandon)
 *     reads as a client-tool result, so the run resumes and the runner re-resolves on cold-replay.
 */
export function agentShouldResumeAfterApproval({messages}: {messages: MessageLike[]}): boolean {
    const last = messages[messages.length - 1]
    if (!last || last.role !== "assistant") return false

    const toolParts = (last.parts ?? []).filter(
        (part) => isToolPart(part) && part.providerExecuted !== true,
    )
    if (toolParts.length === 0) return false

    const hasResolved = toolParts.some(
        (part) => isRespondedToolPart(part) || isClientToolResult(part),
    )
    const allSettled = toolParts.every(isSettledToolPart)
    return hasResolved && allSettled
}
