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
 * The last assistant turn is mid human-in-the-loop: a tool part is either awaiting the user's
 * decision (`approval-requested`) or carries one just given (`approval-responded`, a resume is
 * imminent). Either way the turn isn't really done, even though the stream may have settled.
 */
export function isHitlPending(messages: MessageLike[]): boolean {
    const last = messages[messages.length - 1]
    if (!last || last.role !== "assistant") return false
    return (last.parts ?? []).some(
        (part) =>
            isToolPart(part) &&
            (part.state === "approval-requested" || part.state === "approval-responded"),
    )
}

/**
 * A queued message may release ONLY when the stream has truly settled: the conversation is idle
 * (`status` "ready"), not mid-HITL, and not in the tick before the SDK auto-resumes an answered
 * approval. An "error" status deliberately does NOT release — the queue is held so the user can
 * retry or clear rather than firing follow-ups into a failed turn.
 */
export function canReleaseQueuedMessage(status: string, messages: MessageLike[]): boolean {
    return (
        status === "ready" &&
        !isHitlPending(messages) &&
        !agentShouldResumeAfterApproval({messages})
    )
}
