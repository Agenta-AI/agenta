import type {FileUIPart, UIMessage} from "ai"

/**
 * A message the composer has handed to the durable server queue and that the transcript does not
 * show yet.
 *
 * The server owns admission for every send once a session advertises the `queue` capability, so
 * nothing is added to the local AI SDK chat and the user's own words only reappear after the
 * invoke POST, the durable event, and the records read that adopts them. That is under a second on
 * a local stack and several seconds against a remote deployment, and for the whole window the
 * composer looks like it swallowed the message. These echoes fill exactly that window.
 */
export interface PendingSend {
    /** Client-generated id, the same one the invoke POST sends as its `Idempotency-Key`. */
    id: string
    text: string
    fileParts?: FileUIPart[]
    /**
     * How many durable user messages the transcript must hold before this echo is covered.
     *
     * Coverage is COUNTED, not matched by id: the server does not echo the client id back, and
     * `transcriptToMessages` keys every row by the record's own id. Counting also stays correct
     * when the same text is sent twice, which a text match does not.
     */
    coveredAtUserCount: number
    /**
     * How many durable user messages the transcript held when this echo was created. A transcript
     * that falls BELOW it was rewound past the point this echo belongs to, so the echo can never
     * be covered and is dropped rather than left on screen.
     */
    createdAtUserCount: number
}

export const countUserMessages = (messages: readonly UIMessage[]): number =>
    messages.reduce((total, message) => (message.role === "user" ? total + 1 : total), 0)

/**
 * The user count the NEXT echo waits for: one past whatever the transcript already holds and one
 * past every echo already queued ahead of it, so a burst of sends retires in FIFO order.
 */
export const nextPendingSendCoverage = (
    userCount: number,
    pending: readonly PendingSend[],
): number => Math.max(userCount, ...pending.map((item) => item.coveredAtUserCount)) + 1

/**
 * Drop every echo the durable transcript has caught up with, and every echo a rewind has stranded
 * below its own origin.
 */
export const retirePendingSends = (
    pending: readonly PendingSend[],
    userCount: number,
): readonly PendingSend[] => {
    const next = pending.filter(
        (item) => userCount < item.coveredAtUserCount && userCount >= item.createdAtUserCount,
    )
    return next.length === pending.length ? pending : next
}

/**
 * Disposable user rows for the transcript. The id is prefixed so nothing mistakes an echo for a
 * durable message: rewind looks a message up in the AI SDK array and finds no echo there, which is
 * what we want — an echo is not a turn anyone can rewind to yet.
 */
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
