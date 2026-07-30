import {useEffect, useRef} from "react"

import Session from "supertokens-auth-react/recipe/session"

import {getAgentaApiUrl} from "@/oss/lib/helpers/api"

/** Fatal-close backoff (EventSource does NOT auto-retry from CLOSED): exponential from 1s to
 * a 30s ceiling, jittered 50–100% so a fleet of tabs doesn't reconnect in lockstep. */
const RETRY_BASE_MS = 1_000
const RETRY_MAX_MS = 30_000
const retryDelayMs = (attempt: number): number =>
    Math.round(Math.min(RETRY_BASE_MS * 2 ** attempt, RETRY_MAX_MS) * (0.5 + Math.random() / 2))

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
 * EventSource's built-in reconnect (the server pins its delay with an SSE `retry:` preamble); a
 * fatal CLOSED reopens on a jittered backoff, after first attempting a session refresh — the usual
 * fatal cause is a 401 at the access-token refresh boundary, and a stream has no interceptor to
 * refresh-and-retry the way axios does. The reload/open revalidation stays the fallback either way.
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
        let attempt = 0

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
            const delay = retryDelayMs(attempt)
            attempt += 1
            retryHandle = window.setTimeout(() => {
                retryHandle = undefined
                // Refresh first or every attempt 401s again; reopen either way, since a
                // network failure is not a reason to stop watching.
                void Session.attemptRefreshingSession()
                    .catch(() => false)
                    .finally(open)
            }, delay)
        }

        const open = () => {
            if (disposed || source !== null || document.visibilityState !== "visible") return
            const es = new EventSource(sessionWatchUrl(sessionId, projectId), {
                withCredentials: true,
            })
            source = es
            // One revalidation per (re)connect covers events missed while disconnected — the
            // server has no replay/cursor semantics.
            es.onopen = () => {
                attempt = 0
                notify()
            }
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
