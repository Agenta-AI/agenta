import type {FileUIPart, UIMessage} from "ai"

import {getMessageTurnId} from "./agentTurn"

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
    /**
     * Turn id from the invoke response's first frame, once it arrives. It is the `turn_id` the
     * saved user record carries, so it identifies THIS send among everyone else's.
     */
    executionId?: string | null
    /** The send is known to have failed; the row stays until the host takes the text back. */
    failed?: boolean
    /** Fallback user-row count that covers this echo while its turn id is still unknown. */
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

/**
 * Renumber the counts reserved by echoes queued behind one that left without being covered.
 *
 * Without this, dropping an echo that reserved count four leaves the next one waiting for five
 * while its own saved row arrives as four. It then never retires and duplicates the saved row for
 * good. Only the unacknowledged echoes need it; an acknowledged one retires on its turn id.
 */
export const compactPendingSendCoverage = (
    pending: readonly PendingSend[],
    userCount: number,
): readonly PendingSend[] => {
    let changed = false
    const next = pending.map((item, index) => {
        // Whatever is still outstanding will save as the next rows after the ones already there.
        const expected = userCount + index + 1
        if (item.coveredAtUserCount === expected) return item
        changed = true
        return {...item, coveredAtUserCount: expected}
    })
    return changed ? next : pending
}

/** Turn ids of every user row the durable transcript holds. */
export const durableUserTurnIds = (messages: readonly UIMessage[]): ReadonlySet<string> => {
    const ids = new Set<string>()
    for (const message of messages) {
        if (message.role !== "user") continue
        const turnId = getMessageTurnId(message)
        if (turnId) ids.add(turnId)
    }
    return ids
}

export interface RetirePendingSendsArgs {
    userCount: number
    /** Turn ids of the adopted user rows, which retire an acknowledged echo exactly. */
    durableTurnIds: ReadonlySet<string>
    /** Client ids the durable queue now holds, so the dock owns those rows instead. */
    dockedIds?: ReadonlySet<string>
}

/**
 * Drop every echo something else now owns.
 *
 * An ACKNOWLEDGED echo retires only when its own turn id appears among the saved user rows. It
 * deliberately ignores the count: a foreign row from another tab, a promoted queued input, or a
 * history adoption all raise the count without saying anything about this send.
 *
 * An echo still waiting for its turn id has no identity to match on, so it falls back to the count.
 * That window is the length of one HTTP round trip to the response's first frame.
 */
export const retirePendingSends = (
    pending: readonly PendingSend[],
    {userCount, durableTurnIds, dockedIds}: RetirePendingSendsArgs,
): readonly PendingSend[] => {
    const next = pending.filter((item) => {
        if (dockedIds?.has(item.id)) return false
        if (userCount < item.createdAtUserCount) return false
        if (item.failed) return true
        if (item.executionId) return !durableTurnIds.has(item.executionId)
        return userCount < item.coveredAtUserCount
    })
    if (next.length === pending.length) return pending
    return compactPendingSendCoverage(next, userCount)
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
                metadata: {
                    pendingSend: true,
                    ...(item.executionId ? {pendingSendExecutionId: item.executionId} : {}),
                    ...(item.failed ? {pendingSendFailed: true} : {}),
                },
            }) as unknown as UIMessage,
    )

const previewExecutionId = (message: UIMessage): string | null => {
    const metadata = message.metadata as {executionId?: unknown} | undefined
    return typeof metadata?.executionId === "string" ? metadata.executionId : null
}

/**
 * Order the tail of the transcript: saved rows, then echoes, then live output.
 *
 * A preview for an execution NO echo owns belongs to an earlier turn that has not been retired
 * yet, so it stays above the echoes. A preview for an echo's own execution is that echo's answer
 * and belongs below it.
 */
export const mergePendingSendRows = (
    durable: UIMessage[],
    echoes: UIMessage[],
    preview: UIMessage[],
): UIMessage[] => {
    if (echoes.length === 0 && preview.length === 0) return durable
    if (echoes.length === 0) return [...durable, ...preview]
    if (preview.length === 0) return [...durable, ...echoes]
    const owned = new Set(
        echoes.flatMap((echo) => {
            const metadata = echo.metadata as {pendingSendExecutionId?: unknown} | undefined
            return typeof metadata?.pendingSendExecutionId === "string"
                ? [metadata.pendingSendExecutionId]
                : []
        }),
    )
    const earlier = preview.filter((message) => {
        const id = previewExecutionId(message)
        return !id || !owned.has(id)
    })
    const answers = preview.filter((message) => {
        const id = previewExecutionId(message)
        return !!id && owned.has(id)
    })
    return [...durable, ...earlier, ...echoes, ...answers]
}
