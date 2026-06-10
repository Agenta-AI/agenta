/**
 * Pure transforms for the playground mode switch (chat ⇄ completion).
 *
 * Both operate on the serialized testset message format (plain
 * `{role, content, ...}` objects, the shape `syncChatMessagesToEntity`
 * writes to the row's `messages` column). They never see working-copy
 * metadata (sessionId, parentId, run results), so the "history is plain
 * data" invariant holds by construction.
 *
 * Contract (docs/design/playground-mode-switch/, "Product rules"):
 * - Chat → completion: the conversation up to the last assistant reply
 *   stays in the `messages` column; the trailing assistant reply moves to
 *   the row's run result slot. A conversation that does not end with an
 *   assistant reply (typed-but-unrun user turn, trailing tool call) freezes
 *   whole, with no output.
 * - Completion → chat: the column plus the latest output (appended as the
 *   final assistant turn) become the conversation again.
 * - Round-trip with no edits is identity.
 */

/** Serialized chat message as stored in a testset `messages` column. */
export interface ColumnMessage {
    role: string
    content: unknown
    name?: string
    tool_call_id?: string
    tool_calls?: unknown[]
    [key: string]: unknown
}

export interface FrozenConversation {
    /** Turns that stay in the row's `messages` column. */
    history: ColumnMessage[]
    /** The trailing assistant reply, surfaced as the row's latest output. */
    lastOutput?: ColumnMessage
}

function isColumnMessage(value: unknown): value is ColumnMessage {
    return (
        typeof value === "object" &&
        value !== null &&
        !Array.isArray(value) &&
        typeof (value as {role?: unknown}).role === "string"
    )
}

/**
 * Normalizes an unknown `messages` column value into a message list.
 * Tolerates JSON strings (some testsets store the column stringified)
 * and filters entries without a `role`.
 */
export function normalizeColumnMessages(value: unknown): ColumnMessage[] {
    let parsed = value
    if (typeof parsed === "string") {
        try {
            parsed = JSON.parse(parsed)
        } catch {
            return []
        }
    }
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isColumnMessage)
}

/**
 * Chat → completion: split the conversation into the frozen `messages`
 * column and the trailing assistant reply (the regenerate target).
 *
 * Only a trailing `assistant` message becomes the output. A conversation
 * ending in a user or tool message freezes whole; the output slot starts
 * empty and the next Run fills it.
 */
export function splitConversationForCompletion(messages: ColumnMessage[]): FrozenConversation {
    if (messages.length === 0) return {history: []}
    const last = messages[messages.length - 1]
    if (last.role !== "assistant") return {history: [...messages]}
    return {history: messages.slice(0, -1), lastOutput: last}
}

/**
 * Completion → chat: the `messages` column plus the latest output become
 * the conversation. `latestOutput` is appended as the final assistant
 * turn; earlier runs stay in run history and never re-enter the
 * conversation.
 */
export function mergeConversationFromCompletion(
    history: ColumnMessage[],
    latestOutput?: ColumnMessage | null,
): ColumnMessage[] {
    if (!latestOutput) return [...history]
    return [...history, latestOutput]
}
