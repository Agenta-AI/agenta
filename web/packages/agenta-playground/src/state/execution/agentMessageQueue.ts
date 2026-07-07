/**
 * Agent-lane message-queue release gate.
 *
 * When the user types while a turn is in flight, the FE queues the message and releases it
 * one-by-one after the turn settles. The trap is HUMAN-IN-THE-LOOP: a tool-approval gate ENDS
 * the stream (`status` becomes "ready") while the turn is really paused awaiting the user's
 * approve/deny — and once answered, `useChat` auto-resumes via `sendAutomaticallyWhen`. A queued
 * message must never release into that window, or it would be injected between the assistant's
 * tool gate and its resume, corrupting the turn.
 *
 * Pure + structurally typed (no `ai` dependency), mirroring `agentApprovalResume`: it reads only
 * the fields the AI SDK puts on a UI message (`role`, `parts[].type/state`). It COMPOSES
 * `agentShouldResumeAfterApproval` so "about to auto-resume" is decided by the exact same
 * predicate `useChat`'s `sendAutomaticallyWhen` uses — the two can't drift.
 */

import {agentShouldResumeAfterApproval} from "./agentApprovalResume"

interface ToolPartLike {
    type?: string
    state?: string
}

interface MessageLike {
    role?: string
    parts?: ToolPartLike[]
}

const isToolPart = (part: ToolPartLike): boolean => {
    const type = part?.type
    return typeof type === "string" && (type.startsWith("tool-") || type === "dynamic-tool")
}

/**
 * The last assistant turn is paused awaiting the user's decision on a tool gate
 * (`approval-requested`) — the one HITL state the user can act on (via the ApprovalDock).
 *
 * Deliberately NOT `approval-responded`: that "resume is imminent" hold belongs SOLELY to
 * `agentShouldResumeAfterApproval` (which `canReleaseQueuedMessage` composes). Counting it here too
 * was redundant when the resume fires — and a trap when it doesn't: if the resume run dies before the
 * approved tool part transitions (leaving an orphaned `approval-responded` alongside an unsettled
 * sibling), the resume predicate goes false but this stayed true, freezing the queue with NO dock to
 * unblock it (the dock reads `approval-requested` only, mirroring this). Narrowing to
 * `approval-requested` keeps this in lockstep with `getPendingApprovals` so the freeze and the
 * unblock UI can never disagree.
 */
export function isHitlPending(messages: MessageLike[]): boolean {
    const last = messages[messages.length - 1]
    if (!last || last.role !== "assistant") return false
    return (last.parts ?? []).some(
        (part) => isToolPart(part) && part.state === "approval-requested",
    )
}

/**
 * A queued message may release ONLY when the stream has truly settled: the conversation is not
 * busy, not awaiting a user approval decision, and not in the tick before the SDK auto-resumes an
 * answered approval (that pre-resume hold is `agentShouldResumeAfterApproval`'s job alone). Both
 * "ready" (turn done) and "error" (turn failed) are settled — releasing on "error" fires the
 * user's queued message as a fresh turn (which clears the error), so a failed turn can't strand
 * the queue forever. "submitted"/"streaming" are in-flight and hold.
 */
export function canReleaseQueuedMessage(status: string, messages: MessageLike[]): boolean {
    return (
        (status === "ready" || status === "error") &&
        !isHitlPending(messages) &&
        !agentShouldResumeAfterApproval({messages})
    )
}
