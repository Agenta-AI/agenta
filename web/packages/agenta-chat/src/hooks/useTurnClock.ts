import {useEffect, useState} from "react"

import {useAtomValue, useSetAtom} from "jotai"

import {
    settleTurnSpanAtom,
    startTurnSpanAtom,
    turnSpanAtomFamily,
    turnSpanElapsed,
} from "../state/turnClock"

/** `0:12` while counting; `11s` / `4m 12s` once frozen. */
export const formatElapsed = (ms: number, {live}: {live: boolean}): string => {
    const total = Math.max(0, Math.round(ms / 1000))
    const minutes = Math.floor(total / 60)
    const seconds = total % 60
    if (live) return `${minutes}:${String(seconds).padStart(2, "0")}`
    return minutes ? `${minutes}m ${seconds}s` : `${seconds}s`
}

/**
 * The turn's working time, clocked locally; null for a turn this client never saw live.
 *
 * `startedAt` is when the run began, where the caller can say. Without it a tab opened on a
 * response already in progress starts its count at zero (#6934); it seeds the first span only,
 * so pause and resume still measure working time. `seenFromSend` says this tab watched the run
 * from its send, so every pause is already counted and the start is safe to trust with gates.
 */
export const useTurnClock = (
    messageId: string,
    live: boolean,
    {
        startedAt,
        seenFromSend = false,
        waitingOnReader = false,
    }: {startedAt?: number; seenFromSend?: boolean; waitingOnReader?: boolean} = {},
): number | null => {
    const span = useAtomValue(turnSpanAtomFamily(messageId))
    const start = useSetAtom(startTurnSpanAtom)
    const settle = useSetAtom(settleTurnSpanAtom)
    const [now, setNow] = useState(() => Date.now())

    useEffect(() => {
        if (live) start(messageId, startedAt, seenFromSend)
        else settle(messageId, waitingOnReader)
    }, [live, messageId, startedAt, seenFromSend, waitingOnReader, start, settle])

    useEffect(() => {
        if (!live) return
        const id = setInterval(() => setNow(Date.now()), 1000)
        return () => clearInterval(id)
    }, [live])

    if (!span) return null
    return turnSpanElapsed(span, now)
}
