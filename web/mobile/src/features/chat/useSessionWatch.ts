import {useEffect, useRef, useState} from "react"

import {useQueryClient} from "@tanstack/react-query"

import {tryRefreshSession} from "@/lib/auth"

import {actionableInteractionsQueryKey} from "../sessions/useActionableInteractions"
import {livenessQueryKey} from "../sessions/useLivenessPoll"

import {sessionWatchUrl, watchRetryDelayMs} from "./watchRelay"

/** Minimum spacing between two reconnect revalidations, so a reconnect loop can't fan out
 * into one full records refetch per attempt. */
const MIN_INTERVAL_MS = 3_000

/**
 * One EventSource per foregrounded chat screen (M3 live relay). Events carry no payloads —
 * every handler funnels into the existing revalidate paths:
 *
 * - `records-changed` (and every `open`, for missed-event coverage) → `onRecordsChanged`,
 *   i.e. the transcript tick's body (`revalidateSessionRecordsAtom` + re-read).
 * - `lifecycle` / `interaction` → invalidate the shared liveness + actionable-interactions
 *   queries, and the nav rail's own session queries (no duplicated state; each refetches).
 *
 * Foreground-only: the source closes on `visibilitychange → hidden` and reopens on visible.
 * Transient errors ride EventSource's built-in reconnect (the server pins its delay with an
 * SSE `retry:` preamble). A fatal CLOSED drops to the callers' poll cadence and reopens on a
 * jittered backoff — after first attempting a session refresh, because the usual fatal cause
 * is a 401 at the access-token refresh boundary and a stream has no interceptor to
 * refresh-and-retry the way the Fern/axios calls do.
 */
export const useSessionWatch = ({
    sessionId,
    projectId,
    onRecordsChanged,
    onInteractionChanged,
}: {
    sessionId: string
    projectId: string
    onRecordsChanged: () => void
    onInteractionChanged?: () => void
}): {connected: boolean} => {
    const [connected, setConnected] = useState(false)
    const queryClient = useQueryClient()
    const onRecordsChangedRef = useRef(onRecordsChanged)
    onRecordsChangedRef.current = onRecordsChanged
    const onInteractionChangedRef = useRef(onInteractionChanged)
    onInteractionChangedRef.current = onInteractionChanged

    useEffect(() => {
        if (!sessionId || !projectId) return
        if (typeof window === "undefined" || typeof window.EventSource === "undefined") return

        let source: EventSource | null = null
        let retryHandle: number | undefined
        let disposed = false
        let attempt = 0
        let lastNotifiedAt = 0

        /** Reconnect coverage only — real `records-changed` events are never throttled. */
        const notifyOnConnect = () => {
            const now = Date.now()
            if (now - lastNotifiedAt < MIN_INTERVAL_MS) return
            lastNotifiedAt = now
            onRecordsChangedRef.current()
        }

        const invalidateBadges = () => {
            void queryClient.invalidateQueries({queryKey: livenessQueryKey(projectId)})
            void queryClient.invalidateQueries({
                queryKey: actionableInteractionsQueryKey(projectId),
            })
            // The rail draws the same liveness on its own rows, off its own queries. Without
            // these its dot outlives the run you are watching finish, until the next poll.
            void queryClient.invalidateQueries({queryKey: ["sidebar-sessions"]})
            void queryClient.invalidateQueries({queryKey: ["sidebar-sessions-pinned"]})
            void queryClient.invalidateQueries({queryKey: ["sidebar-sessions-waiting"]})
        }

        const close = () => {
            source?.close()
            source = null
            setConnected(false)
        }

        const scheduleRetry = () => {
            if (disposed || retryHandle !== undefined) return
            const delay = watchRetryDelayMs(attempt)
            attempt += 1
            retryHandle = window.setTimeout(() => {
                retryHandle = undefined
                // A fatal close is most often an expired access token; refresh before
                // reopening or every attempt 401s again. Reopen either way — a network
                // failure is not a reason to stop watching.
                void tryRefreshSession().finally(open)
            }, delay)
        }

        const open = () => {
            if (disposed || source !== null || document.visibilityState !== "visible") return
            const es = new EventSource(sessionWatchUrl(sessionId, projectId), {
                withCredentials: true,
            })
            source = es
            es.onopen = () => {
                setConnected(true)
                attempt = 0
            }
            // Missed-event coverage: one revalidation per (re)connect replaces any
            // replay/cursor semantics on the server. Keyed on `ready`, not `onopen`:
            // headers reach us before the server's Redis subscription is live, so a
            // change landing in that window would miss both this refetch and the stream.
            es.addEventListener("ready", () => {
                notifyOnConnect()
                invalidateBadges()
            })
            es.addEventListener("records-changed", () => onRecordsChangedRef.current())
            es.addEventListener("lifecycle", invalidateBadges)
            es.addEventListener("interaction", () => {
                invalidateBadges()
                onInteractionChangedRef.current?.()
            })
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
