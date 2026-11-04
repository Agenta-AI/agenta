import {useEffect, useRef} from "react"

import {browserLiveStatusQueryAtomFamily} from "@agenta/entities/browser"
import {useAtomValue} from "jotai"

import {useLivenessPoll} from "../sessions/useLivenessPoll"

const TURN_POLL_MS = 10_000
const BROWSING_POLL_MS = 4_000
const RUNNING_POLL_MS = 30_000

/** Keeps the session's browser status fresh; mount once per session screen. */
export const useBrowserStatusPoll = (sessionId: string, projectId: string, enabled: boolean) => {
    const turnRunning = Boolean(
        useLivenessPoll(projectId).data?.find((stream) => stream.session_id === sessionId)?.flags
            ?.is_running,
    )
    const {data, refetch} = useAtomValue(browserLiveStatusQueryAtomFamily(sessionId))
    // A turn starts the browser, but an idle exit or a sandbox teardown stops it with no turn.
    const browserRunning = Boolean(data?.running)
    const wasRunning = useRef(turnRunning)
    useEffect(() => {
        if (!enabled) return
        const ended = wasRunning.current && !turnRunning
        wasRunning.current = turnRunning
        if (ended) void refetch()
        if (!turnRunning && !browserRunning) return
        const timer = setInterval(
            () => void refetch(),
            !turnRunning ? RUNNING_POLL_MS : browserRunning ? BROWSING_POLL_MS : TURN_POLL_MS,
        )
        return () => clearInterval(timer)
    }, [enabled, turnRunning, browserRunning, refetch])
}
