import type {SessionRecord} from "@agenta/entities/session"
import type {UIMessage} from "ai"

import type {EmbedConversation} from "./embedClient"

/** What the list must show before a first message, `!new` or `!use` counts as done. */
export type EmbedAwaiting =
    | {kind: "thread"; previousThreadId: string | null}
    | {kind: "session"; target: EmbedConversation}

/** The server's current conversation: the newest row, which is where the next message goes. */
export const currentConversation = (
    conversations: EmbedConversation[] | undefined,
): EmbedConversation | null => conversations?.[0] ?? null

export const isAwaitingSatisfied = (
    awaiting: EmbedAwaiting,
    conversations: EmbedConversation[] | undefined,
): boolean => {
    const current = currentConversation(conversations)
    if (!current) return false
    return awaiting.kind === "thread"
        ? current.thread_id !== awaiting.previousThreadId
        : current.session_id === awaiting.target.session_id
}

export const latestRecordSequence = (records: SessionRecord[]): number =>
    records.reduce((max, record) => Math.max(max, record.sequence ?? 0), 0)

/** The live-preview entities the records now hold, so their preview can retire. */
export const recordedEntityIds = (records: SessionRecord[]): Set<string> =>
    new Set(
        records.flatMap((record) => {
            const payload = record.payload as Record<string, unknown> | null
            if (!payload) return []
            const id =
                payload.type === "message" || payload.type === "thought"
                    ? payload.message_id
                    : payload.type === "tool_result"
                      ? payload.id
                      : undefined
            return typeof id === "string" ? [id] : []
        }),
    )

export const userMessageCount = (messages: UIMessage[]): number =>
    messages.filter((message) => message.role === "user").length

/** The open choice's token for this answer. The outbox writes `<interaction row id>:<option>`. */
export const choiceToken = (tokens: string[], approved: boolean): string | null =>
    tokens.find((token) => token.endsWith(approved ? ":approve" : ":deny")) ?? null

/** A message this widget sent, shown until the session's records hold it. */
export const optimisticUserMessage = (text: string, fileNames: string[]): UIMessage =>
    ({
        id: "embed-pending-send",
        role: "user",
        parts: [
            ...(text ? [{type: "text", text}] : []),
            ...fileNames.map((name) => ({
                type: "file",
                mediaType: "application/octet-stream",
                filename: name,
                url: "",
            })),
        ],
    }) as UIMessage
