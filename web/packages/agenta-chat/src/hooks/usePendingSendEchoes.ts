import {useCallback, useEffect, useMemo, useState} from "react"

import type {UIMessage} from "ai"

import {
    compactPendingSendCoverage,
    countUserMessages,
    durableUserTurnIds,
    nextPendingSendCoverage,
    pendingSendEchoMessages,
    retirePendingSendEchoes,
    type PendingSendEcho,
} from "../assets/pendingSendEchoes"

export interface PendingSendEchoInput {
    id: string
    text: string
    fileParts?: PendingSendEcho["fileParts"]
}

export interface PendingSendEchoes {
    /** Disposable user rows to render between the saved transcript and the live answer. */
    rows: UIMessage[]
    /** Show a send immediately, before its request leaves. */
    add: (input: PendingSendEchoInput) => void
    /** The server named the turn this send started; from here it retires on that id alone. */
    markAccepted: (id: string, executionId: string) => void
    /** The server parked it; from here it retires when the dock is OBSERVED to list that input. */
    markParked: (id: string, inputId: string) => void
    /** The send failed after the composer cleared. The row STAYS, flagged, so no text is lost. */
    markFailed: (id: string) => void
    /** The caller will restore the text itself, so the row can go. */
    drop: (id: string) => void
}

/**
 * Owns the echo rows for durable sends, separately from the queue's other duties.
 *
 * State is the only source of truth. Nothing is written during render: React can abandon a render,
 * and a ref mutated there is not rolled back, which loses an echo permanently and lets the next
 * send reserve a count that is already taken. Visible rows are instead DERIVED by pure filtering,
 * so an adopted row and its echo never appear together even for one commit, and the stored list is
 * pruned afterwards in an effect where a discarded render cannot do harm.
 */
export const usePendingSendEchoes = ({
    messages,
    dockedInputIds,
}: {
    messages: UIMessage[]
    dockedInputIds: ReadonlySet<string>
}): PendingSendEchoes => {
    const [echoes, setEchoes] = useState<readonly PendingSendEcho[]>([])

    const userCount = countUserMessages(messages)
    const durableTurnIds = useMemo(() => durableUserTurnIds(messages), [messages])
    const retireArgs = useMemo(
        () => ({userCount, durableTurnIds, dockedIds: dockedInputIds}),
        [userCount, durableTurnIds, dockedInputIds],
    )

    const visible = useMemo(() => retirePendingSendEchoes(echoes, retireArgs), [echoes, retireArgs])

    // Housekeeping only: render already hides these. The updater is pure and re-derives from the
    // list React hands it, so a send admitted between this render and this effect survives.
    useEffect(() => {
        setEchoes((current) => retirePendingSendEchoes(current, retireArgs))
    }, [retireArgs])

    // `userCount` is closed over as a plain value, so the updaters stay pure and React may replay
    // them freely. Coverage itself is allocated from the list React hands the updater.
    const add = useCallback(
        (input: PendingSendEchoInput) => {
            setEchoes((current) => [
                ...current,
                {
                    id: input.id,
                    text: input.text,
                    fileParts: input.fileParts,
                    coveredAtUserCount: nextPendingSendCoverage(userCount, current),
                    createdAtUserCount: userCount,
                },
            ])
        },
        [userCount],
    )

    const drop = useCallback(
        (id: string) => {
            setEchoes((current) => {
                const next = current.filter((item) => item.id !== id)
                if (next.length === current.length) return current
                // An echo behind a dropped one reserved a count that is now one too high and
                // would never retire.
                return compactPendingSendCoverage(next, userCount)
            })
        },
        [userCount],
    )

    const mark = useCallback((id: string, patch: Partial<PendingSendEcho>) => {
        setEchoes((current) => {
            const index = current.findIndex((item) => item.id === id)
            if (index < 0) return current
            const next = [...current]
            next[index] = {...current[index], ...patch}
            return next
        })
    }, [])

    const markAccepted = useCallback(
        (id: string, executionId: string) => mark(id, {executionId}),
        [mark],
    )
    const markParked = useCallback(
        (id: string, inputId: string) => mark(id, {parkedInputId: inputId}),
        [mark],
    )
    const markFailed = useCallback((id: string) => mark(id, {failed: true}), [mark])

    const rows = useMemo(() => pendingSendEchoMessages(visible), [visible])

    return {rows, add, markAccepted, markParked, markFailed, drop}
}
