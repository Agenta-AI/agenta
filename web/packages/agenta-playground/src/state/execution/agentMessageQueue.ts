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

import {agentShouldResumeAfterApproval, isPendingClientToolInteraction} from "./agentApprovalResume"
import {buildRenderMap} from "./renderMap"

interface ToolPartLike {
    type?: string
    state?: string
}

interface MessageLike {
    role?: string
    parts?: ToolPartLike[]
    metadata?: unknown
}

type ApprovalContinuationState = "running" | "done" | "error"

interface ApprovalContinuationMeta {
    executionId?: string
    state?: ApprovalContinuationState
}

const latestApprovalContinuation = (
    messages: MessageLike[],
): ApprovalContinuationMeta | undefined => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
        const continuation = (
            messages[i]?.metadata as {approvalContinuation?: ApprovalContinuationMeta} | undefined
        )?.approvalContinuation
        if (continuation?.state) return continuation
    }
    return undefined
}

const latestApprovalContinuationState = (
    messages: MessageLike[],
): ApprovalContinuationState | undefined => latestApprovalContinuation(messages)?.state

/**
 * A durable approval continuation is still in flight for this conversation.
 *
 * `canReleaseQueuedMessage` already holds on this, but the gate is not the only release path:
 * `useAgentChatQueue` also releases on a user stop and on an ORPHANED restored resume shape. The
 * orphan hatch is true for EVERY durable answer — the answer retires the local gate marker, and
 * the first adopted server transcript makes the tail a restored "resume imminent" message — so
 * without this predicate it walks around the hold and sends into the running continuation, which
 * supersedes it on the runner and aborts the tool call the user just approved.
 */
export function hasRunningApprovalContinuation(messages: MessageLike[]): boolean {
    return latestApprovalContinuationState(messages) === "running"
}

/**
 * The transcript carries a terminal record for `executionId` — the only proof a client that never
 * streamed the continuation has that the continuation is over. A DIFFERENT execution id counts as
 * settled: a later continuation replaced this one, so this id can never terminate.
 */
export function approvalContinuationSettled(messages: MessageLike[], executionId: string): boolean {
    const continuation = latestApprovalContinuation(messages)
    if (!continuation) return false
    if (continuation.executionId !== executionId) return true
    return continuation.state === "done" || continuation.state === "error"
}

const isToolPart = (part: ToolPartLike): boolean => {
    const type = part?.type
    return typeof type === "string" && (type.startsWith("tool-") || type === "dynamic-tool")
}

/**
 * An assistant turn is paused awaiting the user's decision on a tool gate
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
    return messages.some(messageHasPendingHitl)
}

/** The per-message half of `isHitlPending`, so a "waiting for you" marker paints on the turn that
 * actually holds the gate instead of the newest one. Built from the same predicate on purpose. */
export function messageHasPendingHitl(message: MessageLike): boolean {
    if (message.role !== "assistant") return false
    const parts = message.parts ?? []
    const renderMap = buildRenderMap(parts)
    return parts.some(
        (part) =>
            (isToolPart(part) && part.state === "approval-requested") ||
            isPendingClientToolInteraction(part, renderMap),
    )
}

/**
 * A queued message may release ONLY when the stream has truly settled: the conversation is not
 * busy, not awaiting a user approval decision, and not in the tick before the SDK auto-resumes an
 * answered approval (that pre-resume hold is `agentShouldResumeAfterApproval`'s job alone). Both
 * "ready" (turn done) and "error" (turn failed) are settled — releasing on "error" fires the
 * user's queued message as a fresh turn (which clears the error), so a failed turn can't strand
 * the queue forever. "submitted"/"streaming" are in-flight and hold.
 *
 * On "error" the pre-resume hold is VOID: an errored status means the auto-resume already fired
 * and died (the resolved tool parts linger, so the resume predicate stays true forever — AGE-3937).
 * There is no imminent resume left to protect, and no dock to unblock the user; holding would
 * freeze the queue permanently. `isHitlPending` still holds — its dock IS the unblock UI.
 */
export function canReleaseQueuedMessage(status: string, messages: MessageLike[]): boolean {
    const continuationState = latestApprovalContinuationState(messages)
    if (continuationState === "running") return false
    if (status === "error") return !isHitlPending(messages)
    if (status === "ready" && (continuationState === "done" || continuationState === "error")) {
        return !isHitlPending(messages)
    }
    const lastAssistant = messages.findLast((message) => message.role === "assistant")
    const recordTerminal = (lastAssistant?.metadata as {recordTerminal?: unknown} | undefined)
        ?.recordTerminal
    if (status === "ready" && recordTerminal === true) {
        return !isHitlPending(messages)
    }
    return (
        status === "ready" &&
        !isHitlPending(messages) &&
        !agentShouldResumeAfterApproval({messages})
    )
}
