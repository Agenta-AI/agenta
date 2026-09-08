import type {FileUIPart, UIMessage} from "ai"

/**
 * A sent message the durable transcript has not echoed back yet.
 *
 * A session advertising the `queue` capability admits every send server-side and adds nothing to
 * the local AI SDK chat, so the message is invisible until the invoke POST, the durable event, and
 * the adopting records read all land. These rows fill that window.
 */
export interface PendingSend {
    /** Client-generated id, the same one the invoke POST sends as its `Idempotency-Key`. */
    id: string
    text: string
    fileParts?: FileUIPart[]
    /** User-row count that covers this echo; counted, not matched by id, because the server
     * keys saved rows by the record's own id and never returns the client id. */
    coveredAtUserCount: number
    /** User-row count when this echo was made; falling below it means a rewind stranded it. */
    createdAtUserCount: number
}

export const countUserMessages = (messages: readonly UIMessage[]): number =>
    messages.reduce((total, message) => (message.role === "user" ? total + 1 : total), 0)

/** One past the transcript and past every waiting echo, so a burst retires in FIFO order. */
export const nextPendingSendCoverage = (
    userCount: number,
    pending: readonly PendingSend[],
): number => Math.max(userCount, ...pending.map((item) => item.coveredAtUserCount)) + 1

/** Drop echoes the transcript has caught up with, and echoes a rewind stranded below their origin. */
export const retirePendingSends = (
    pending: readonly PendingSend[],
    userCount: number,
): readonly PendingSend[] => {
    const next = pending.filter(
        (item) => userCount < item.coveredAtUserCount && userCount >= item.createdAtUserCount,
    )
    return next.length === pending.length ? pending : next
}

/** Disposable user rows; the id prefix keeps rewind from finding an echo in the AI SDK array. */
export const pendingSendMessages = (pending: readonly PendingSend[]): UIMessage[] =>
    pending.map(
        (item) =>
            ({
                id: `pending-send-${item.id}`,
                role: "user",
                parts: [
                    ...(item.text ? [{type: "text" as const, text: item.text}] : []),
                    ...(item.fileParts ?? []),
                ],
                metadata: {pendingSend: true},
            }) as unknown as UIMessage,
    )
