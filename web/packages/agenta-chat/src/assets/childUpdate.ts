import type {PendingSessionInput} from "@agenta/entities/session"

/** What a child update reports: `running` for the still-running update, else a pause or an end. */
export const CHILD_UPDATE_STATUSES = [
    "running",
    "paused",
    "completed",
    "failed",
    "cancelled",
    "lost",
] as const

export type ChildUpdateStatus = (typeof CHILD_UPDATE_STATUSES)[number]

/** The server-written part of a child update: which child session, which turn, what happened. */
export interface ChildUpdate {
    sessionId: string
    turnId: string | null
    /** Null for a value this client does not know yet; the row still shows as an update. */
    status: ChildUpdateStatus | null
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
    value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null

/** Anything but `message` is written by the server. Absent reads as `message` (older servers). */
export const isServerInput = (input: Pick<PendingSessionInput, "kind">): boolean =>
    Boolean(input.kind) && input.kind !== "message"

/**
 * The structured part `child_update {session_id, turn_id, status}` of a child update row.
 *
 * Read only on a row with `kind = child_update`: only the server writes that kind, so a client
 * that copies the part into its own message changes nothing. It sits on the last user message of
 * the row's invoke request, beside `display_content`. Never parse the message text for it: that
 * text is for the model and its form can change.
 */
export const childUpdateOfInput = (input: PendingSessionInput): ChildUpdate | null => {
    if (input.kind !== "child_update") return null
    const data = asRecord(input.content.data)
    const inputs = asRecord(data?.inputs)
    const messages = Array.isArray(inputs?.messages) ? inputs.messages : []
    const message = [...messages]
        .reverse()
        .map(asRecord)
        .find((candidate) => candidate?.role === "user")
    const part = asRecord(message?.child_update)
    const sessionId = part?.session_id
    if (typeof sessionId !== "string" || !sessionId) return null
    const status = part?.status
    return {
        sessionId,
        turnId: typeof part?.turn_id === "string" && part.turn_id ? part.turn_id : null,
        status: CHILD_UPDATE_STATUSES.includes(status as ChildUpdateStatus)
            ? (status as ChildUpdateStatus)
            : null,
    }
}
