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
export const isServerInput = (input: {kind?: string | null}): boolean =>
    Boolean(input.kind) && input.kind !== "message"

/** The part's fields, or null when it names no child session. */
const childUpdateOfPart = (value: unknown): ChildUpdate | null => {
    const part = asRecord(value)
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

/**
 * The structured part `child_update {session_id, turn_id, status}` of a child update row.
 *
 * Read only on a row with `kind = child_update`: only the server writes that kind, so a client
 * that copies the part into its own message changes nothing. It sits on the last message of the
 * row's invoke request (`content.data.inputs.messages[-1]`), beside `display_content`. Never
 * parse the message text for it: that text is for the model and its form can change.
 */
export const childUpdateOfInput = (input: PendingSessionInput): ChildUpdate | null => {
    if (input.kind !== "child_update") return null
    const data = asRecord(input.content.data)
    const inputs = asRecord(data?.inputs)
    const messages = Array.isArray(inputs?.messages) ? inputs.messages : []
    return childUpdateOfPart(asRecord(messages.at(-1))?.child_update)
}

/**
 * The same part on the stored user `message` record of the turn the update started
 * (`attributes.child_update`). The records ingest writes it from the server row and drops a
 * `child_update` key that any producer sends, so only the server can make a record carry it.
 */
export const childUpdateOfRecord = (record: {
    sender?: string | null
    session_update?: string | null
    payload?: Record<string, unknown> | null
}): ChildUpdate | null =>
    record.sender === "user" && record.session_update === "message"
        ? childUpdateOfPart(record.payload?.child_update)
        : null

/** The child update a transcript user message came from, as `transcriptToMessages` stamps it. */
export const getMessageChildUpdate = (message: {metadata?: unknown}): ChildUpdate | null => {
    const value = asRecord(asRecord(message.metadata)?.childUpdate)
    return typeof value?.sessionId === "string" && value.sessionId
        ? (value as unknown as ChildUpdate)
        : null
}
