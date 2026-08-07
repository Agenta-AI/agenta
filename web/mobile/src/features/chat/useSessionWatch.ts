import {useEffect, useRef, useState} from "react"

import {useQueryClient} from "@tanstack/react-query"

import {actionableInteractionsQueryKey} from "../sessions/useActionableInteractions"
import {livenessQueryKey} from "../sessions/useLivenessPoll"

import {sessionWatchUrl} from "./watchRelay"

/** Fatal-close retry cadence (EventSource does NOT auto-retry from CLOSED). */
const RETRY_MS = 60_000

/**
 * One EventSource per foregrounded chat screen (M3 live relay). Events carry no payloads —
 * every handler funnels into the existing revalidate paths:
 *
 * - `records-changed` (and every `open`, for missed-event coverage) → `onRecordsChanged`,
 *   i.e. the transcript tick's body (`revalidateSessionRecordsAtom` + re-read).
 * - `lifecycle` / `interaction` → invalidate the shared liveness + actionable-interactions
 *   queries (no duplicated state; the badges' own queries refetch).
 *
 * Foreground-only: the source closes on `visibilitychange → hidden` and reopens on visible.
 * Transient errors ride EventSource's built-in reconnect; a fatal CLOSED (endpoint missing,
 * proxy reset) drops to the callers' poll cadence and retries every 60s while visible.
 */
export const useSessionWatch = ({
    sessionId,
    projectId,
    onRecordsChanged,
}: {
    sessionId: string
    projectId: string
    onRecordsChanged: () => void
}): {connected: boolean} => {
    const [connected, setConnected] = useState(false)
    const queryClient = useQueryClient()
    const onRecordsChangedRef = useRef(onRecordsChanged)
    onRecordsChangedRef.current = onRecordsChanged

    useEffect(() => {
        if (!sessionId || !projectId) return
        if (typeof window === "undefined" || typeof window.EventSource === "undefined") return

        let source: EventSource | null = null
        let retryHandle: number | undefined
        let disposed = false

        const invalidateBadges = () => {
            void queryClient.invalidateQueries({queryKey: livenessQueryKey(projectId)})
            void queryClient.invalidateQueries({
                queryKey: actionableInteractionsQueryKey(projectId),
            })
        }

        const close = () => {
            source?.close()
            source = null
            setConnected(false)
        }

        const scheduleRetry = () => {
            if (disposed || retryHandle !== undefined) return
            retryHandle = window.setTimeout(() => {
                retryHandle = undefined
                open()
            }, RETRY_MS)
        }

        const open = () => {
            if (disposed || source !== null || document.visibilityState !== "visible") return
            const es = new EventSource(sessionWatchUrl(sessionId, projectId), {
                withCredentials: true,
            })
            source = es
            es.onopen = () => {
                setConnected(true)
                // Missed-event coverage: one revalidation per (re)connect replaces
                // any replay/cursor semantics on the server.
                onRecordsChangedRef.current()
                invalidateBadges()
            }
            es.addEventListener("records-changed", () => onRecordsChangedRef.current())
            es.addEventListener("lifecycle", invalidateBadges)
            es.addEventListener("interaction", invalidateBadges)
            es.onerror = () => {
                setConnected(false)
                // CONNECTING = built-in auto-reconnect; only a fatal CLOSED needs us.
                if (es.readyState === EventSource.CLOSED) {
                    close()
                    scheduleRetry()
                }
            }
        }

        const onVisibility = () => {
            if (document.visibilityState === "visible") open()
            else close()
        }

        document.addEventListener("visibilitychange", onVisibility)
        open()
        return () => {
            disposed = true
            document.removeEventListener("visibilitychange", onVisibility)
            if (retryHandle !== undefined) window.clearTimeout(retryHandle)
            close()
        }
    }, [sessionId, projectId, queryClient])

    return {connected}
}
