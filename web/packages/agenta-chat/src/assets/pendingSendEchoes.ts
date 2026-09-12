import type {FileUIPart, UIMessage} from "ai"

import {getMessageTurnId} from "./agentTurn"

/**
 * A sent message the UI has nowhere else to show yet.
 *
 * A session advertising the `queue` capability admits every send server-side and adds nothing to
 * the local AI SDK chat, so the message is invisible until the invoke POST, the durable event, and
 * the adopting records read all land. These rows fill that window and are display state only.
 */
export interface PendingSendEcho {
    /** Client-generated id, the same one the invoke POST sends as its `Idempotency-Key`. */
    id: string
    text: string
    fileParts?: FileUIPart[]
    /**
     * Turn id from the invoke response's acceptance frame. It is the `turn_id` the saved user
     * record carries, so it identifies THIS send among everyone else's.
     */
    executionId?: string | null
    /** Durable input id from a 202 body; the dock owns the row once it reports this id. */
    parkedInputId?: string | null
    /** The send is known to have failed. The row STAYS, so the text is never silently lost. */
    failed?: boolean
    /** Fallback user-row count, used only while this send has no identity of its own yet. */
    coveredAtUserCount: number
    /** User-row count when this echo was made; falling below it means a rewind stranded it. */
    createdAtUserCount: number
}

export const countUserMessages = (messages: readonly UIMessage[]): number =>
    messages.reduce((total, message) => (message.role === "user" ? total + 1 : total), 0)

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

/** One past the transcript and past every waiting echo, so a burst retires in FIFO order. */
export const nextPendingSendCoverage = (
    userCount: number,
    pending: readonly PendingSendEcho[],
): number => Math.max(userCount, ...pending.map((item) => item.coveredAtUserCount)) + 1

/**
 * Renumber the counts reserved by echoes queued behind one that left without being covered.
 *
 * Without this, dropping an echo that reserved count four leaves the next one waiting for five
 * while its own saved row arrives as four. It then never retires and duplicates the saved row.
 */
export const compactPendingSendCoverage = (
    pending: readonly PendingSendEcho[],
    userCount: number,
): readonly PendingSendEcho[] => {
    let changed = false
    const next = pending.map((item, index) => {
        const expected = userCount + index + 1
        if (item.coveredAtUserCount === expected) return item
        changed = true
        return {...item, coveredAtUserCount: expected}
    })
    return changed ? next : pending
}

export interface RetirePendingSendEchoesArgs {
    userCount: number
    /** Turn ids of the adopted user rows, which retire an acknowledged echo exactly. */
    durableTurnIds: ReadonlySet<string>
    /** Input ids the durable queue is OBSERVED to hold, not merely reported to have accepted. */
    dockedIds: ReadonlySet<string>
}

/**
 * Decide which echoes are still worth showing.
 *
 * Pure, and safe to call during render: it returns the same array reference when nothing retires.
 *
 * An echo retires only on evidence about ITSELF. A parked one waits for the dock to actually list
 * its input id. An acknowledged one waits for its own turn id among the saved user rows, and
 * deliberately ignores the count, because another tab's message, a promoted queued input, a Steer,
 * or a history adoption all raise the count while saying nothing about this send. Only an echo
 * with no identity yet falls back to the count, for the one round trip before its first frame.
 */
export const retirePendingSendEchoes = (
    pending: readonly PendingSendEcho[],
    {userCount, durableTurnIds, dockedIds}: RetirePendingSendEchoesArgs,
): readonly PendingSendEcho[] => {
    const next = pending.filter((item) => {
        if (userCount < item.createdAtUserCount) return false
        // The saved row is the strongest evidence there is, so it is checked FIRST. A row that
        // turns up late still retires an echo an earlier guess had already flagged as failed.
        if (item.executionId) return !durableTurnIds.has(item.executionId)
        // A parked input that is promoted before any snapshot observes it disappears from the
        // dock query for good, and it never gets a turn id of its own, so dock membership cannot
        // be its only successor. The count is the fallback that keeps it from waiting forever.
        if (item.parkedInputId)
            return !dockedIds.has(item.parkedInputId) && userCount < item.coveredAtUserCount
        // A failed send outlives everything else here. The composer has already cleared, so
        // dropping the row would delete the user's text with nothing to show for it.
        if (item.failed) return true
        return userCount < item.coveredAtUserCount
    })
    if (next.length === pending.length) return pending
    return compactPendingSendCoverage(next, userCount)
}

/** Disposable user rows; the id prefix keeps rewind from finding an echo in the AI SDK array. */
/**
 * Is a send still on its way to the runner, or streaming as an echo this client owns?
 *
 * Every echo that is not refused and not parked in the queue is a turn THIS client started and is
 * still waiting on: from the moment it leaves the composer until its durable row retires it. That
 * is the local "submitted" signal the AI SDK's `status` carries on the direct path, which the
 * server-owned send path never sets — without it the working indicator waited for the next
 * liveness poll to notice the run (#6778).
 */
export const pendingSendsInFlight = (pending: readonly PendingSendEcho[]): boolean =>
    pending.some((echo) => !echo.failed && !echo.parkedInputId)

export const pendingSendEchoMessages = (pending: readonly PendingSendEcho[]): UIMessage[] =>
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

/** True for an echo whose send is known to have failed, so a host can say so on the row. */
export const isPendingSendFailed = (message: UIMessage): boolean =>
    (message.metadata as {pendingSendFailed?: unknown} | undefined)?.pendingSendFailed === true

/**
 * Shown on a failed echo. Word for word what the composer says when a send is refused before it
 * resolves, because to the user those are one event and two phrasings read as carelessness.
 */
export const PENDING_SEND_FAILED_NOTE = "Message wasn't sent — try again."

const previewExecutionId = (message: UIMessage): string | null => {
    const metadata = message.metadata as {executionId?: unknown} | undefined
    return typeof metadata?.executionId === "string" ? metadata.executionId : null
}

const echoExecutionId = (message: UIMessage): string | null => {
    const metadata = message.metadata as {pendingSendExecutionId?: unknown} | undefined
    return typeof metadata?.pendingSendExecutionId === "string"
        ? metadata.pendingSendExecutionId
        : null
}

/**
 * Order the tail of the transcript: saved rows, then any answer already streaming, then the
 * echoes, then the answers to those echoes.
 *
 * Splitting the previews needs every echo to name its own execution. While one is still
 * unacknowledged, a preview cannot be attributed, and guessing puts an answer above its own
 * question. So the split applies only when all of them are acknowledged; otherwise the echoes go
 * last, which is wrong for at most the previous answer and never for the new one.
 */
export const mergePendingSendEchoRows = (
    durable: UIMessage[],
    echoes: UIMessage[],
    preview: UIMessage[],
): UIMessage[] => {
    if (echoes.length === 0 && preview.length === 0) return durable
    if (echoes.length === 0) return [...durable, ...preview]
    if (preview.length === 0) return [...durable, ...echoes]
    const ids = echoes.map(echoExecutionId)
    if (ids.some((id) => id === null)) return [...durable, ...preview, ...echoes]
    const owned = new Set(ids as string[])
    const earlier: UIMessage[] = []
    const answers: UIMessage[] = []
    for (const message of preview) {
        const id = previewExecutionId(message)
        if (id && owned.has(id)) answers.push(message)
        else earlier.push(message)
    }
    return [...durable, ...earlier, ...echoes, ...answers]
}
