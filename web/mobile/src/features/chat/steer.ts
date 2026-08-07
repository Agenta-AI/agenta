import {getEnv} from "@/lib/env"

/**
 * Steer-lite (deny + redirect): gates the approval dock's "Redirect" control, mirroring the
 * desktop flag `NEXT_PUBLIC_AGENT_CHAT_STEER` (`isAgentChatSteerEnabled`). OFF by default.
 *
 * Why it stays off: the redirect note only reaches the model on the runner's COLD-replay path,
 * where it closes the replayed transcript as the next user turn. A warm-parked sandbox — the
 * normal case for a phone answer since the approval park TTL became 30 minutes — resumes by
 * answering the harness gate on the still-pending original prompt and sends no new prompt at
 * all, so the note is dropped (verified live: the model re-tried the denied work with another
 * tool). The harness has no reject-with-feedback channel to carry it either
 * (`PermissionReply = "once" | "always" | "reject"`). Flip this on once the runner delivers a
 * redirect in-band with the denial (#5444).
 */
export const isSteerEnabled = (): boolean =>
    (getEnv("NEXT_PUBLIC_AGENT_CHAT_STEER") || "").toLowerCase() === "true"

/** Extends `Record` because the respond endpoint's `answer` is an open payload. */
export interface ApprovalAnswer extends Record<string, unknown> {
    approved: boolean
    message?: string
}

/**
 * The `answer` payload for `POST /sessions/interactions/{id}/respond`. A blank or whitespace-only
 * note is omitted entirely, so a redirect with no text is a plain deny rather than an empty
 * trailing user message in the resumed conversation.
 */
export const buildApprovalAnswer = (approved: boolean, message?: string): ApprovalAnswer => {
    const note = message?.trim()
    return note ? {approved, message: note} : {approved}
}
