import {useEffect, useRef} from "react"

import {browserLiveStatusQueryAtomFamily} from "@agenta/entities/browser"
import {useAtomValue} from "jotai"

const TURN_POLL_MS = 10_000
const BROWSING_POLL_MS = 4_000
const RUNNING_POLL_MS = 30_000

/** Keeps the session's browser status fresh; mount once per session screen. */
/** Null stops the poll. A turn starts the browser; an idle exit or a teardown stops it with none. */
export const browserPollMs = (turnRunning: boolean, browserRunning: boolean): number | null =>
    !turnRunning
        ? browserRunning
            ? RUNNING_POLL_MS
            : null
        : browserRunning
          ? BROWSING_POLL_MS
          : TURN_POLL_MS

/** `turnRunning` is the conversation's own: the project liveness poll stops while it reads idle. */
export const useBrowserStatusPoll = (sessionId: string, turnRunning: boolean, enabled: boolean) => {
    const {data, refetch} = useAtomValue(browserLiveStatusQueryAtomFamily(sessionId))
    const browserRunning = Boolean(data?.running)
    const wasRunning = useRef(turnRunning)
    useEffect(() => {
        if (!enabled) return
        const ended = wasRunning.current && !turnRunning
        wasRunning.current = turnRunning
        if (ended) void refetch()
        const ms = browserPollMs(turnRunning, browserRunning)
        if (ms === null) return
        const timer = setInterval(() => void refetch(), ms)
        return () => clearInterval(timer)
    }, [enabled, turnRunning, browserRunning, refetch])
}
