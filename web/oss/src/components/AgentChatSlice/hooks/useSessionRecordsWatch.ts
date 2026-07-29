import {useEffect, useRef} from "react"

import {getAgentaApiUrl} from "@/oss/lib/helpers/api"

/** Fatal-close retry cadence (EventSource does NOT auto-retry from CLOSED). */
const RETRY_MS = 60_000

/** Minimum spacing between two revalidations, so a streaming turn's record batches can't fan out
 * into one full record-log refetch per event. */
const MIN_INTERVAL_MS = 3_000

/** Watch endpoint URL — same-origin `/api` + cookie auth, consumed via native EventSource. */
const sessionWatchUrl = (sessionId: string, projectId: string): string =>
    `${getAgentaApiUrl()}/sessions/streams/watch?session_id=${encodeURIComponent(
        sessionId,
    )}&project_id=${encodeURIComponent(projectId)}`

/**
 * Live records relay (M3) for the desktop chat: one EventSource per ACTIVE conversation, so a turn
 * that advances anywhere else (an approval answered on mobile, a run on another device) converges
 * here within seconds instead of only on reload.
 *
 * Events carry no payload — `records-changed` (and every `open`, for missed-event coverage) just
 * calls back into the caller's existing revalidate + guarded-adopt path. Foreground-only: the
 * source closes on `visibilitychange → hidden` and reopens on visible. Transient errors ride
 * EventSource's built-in reconnect; a fatal CLOSED (endpoint missing, proxy reset, unauthenticated)
 * retries every 60s while visible — the reload/open revalidation stays the fallback either way.
 *
 * Mirrors `web/mobile/src/features/chat/useSessionWatch.ts` (same endpoint, same contract) minus
 * the mobile-only badge invalidations.
 */
export const useSessionRecordsWatch = ({
    sessionId,
    projectId,
    enabled,
    onRecordsChanged,
}: {
    sessionId: string
    projectId?: string | null
    /** Only the visible/active conversation subscribes — inactive tabs stay mounted in antd Tabs. */
    enabled: boolean
    onRecordsChanged: () => void
}): void => {
    const onRecordsChangedRef = useRef(onRecordsChanged)
    onRecordsChangedRef.current = onRecordsChanged

    useEffect(() => {
        if (!enabled || !sessionId || !projectId) return
        if (typeof window === "undefined" || typeof window.EventSource === "undefined") return

        let source: EventSource | null = null
        let retryHandle: number | undefined
        let disposed = false
        let lastNotifiedAt = 0

        const notify = () => {
            const now = Date.now()
            if (now - lastNotifiedAt < MIN_INTERVAL_MS) return
            lastNotifiedAt = now
            onRecordsChangedRef.current()
        }

        const close = () => {
            source?.close()
            source = null
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
            // One revalidation per (re)connect covers events missed while disconnected — the
            // server has no replay/cursor semantics.
            es.onopen = notify
            es.addEventListener("records-changed", notify)
            es.onerror = () => {
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
    }, [sessionId, projectId, enabled])
}
