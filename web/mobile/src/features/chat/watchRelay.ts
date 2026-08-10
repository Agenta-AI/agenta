import {getApiUrl} from "@/lib/env"

/** Watch endpoint URL — same-origin `/api` + cookie auth, consumed via native EventSource. */
export const sessionWatchUrl = (sessionId: string, projectId: string): string =>
    `${getApiUrl()}/sessions/streams/watch?session_id=${encodeURIComponent(
        sessionId,
    )}&project_id=${encodeURIComponent(projectId)}`

/**
 * Records-tick cadence under the relay: while the EventSource is open the tick is only a
 * safety net (30s); on error/close the caller's base cadence (today's 4s/7.5s/idle-0)
 * stands unchanged — the fallback IS the current behavior. An idle 0 never wakes up.
 */
export const watchAwarePollMs = (baseMs: number, connected: boolean): number =>
    connected && baseMs > 0 ? 30_000 : baseMs

/** Backoff bounds for a fatal (CLOSED) EventSource — see `watchRetryDelayMs`. */
export const WATCH_RETRY_BASE_MS = 1_000
export const WATCH_RETRY_MAX_MS = 30_000

/**
 * Delay before reopening a fatally-closed relay: exponential from 1s to a 30s ceiling,
 * with 50–100% jitter so a fleet of tabs coming back from one API restart doesn't
 * reconnect in lockstep. The common fatal cause is a 401 at the access-token refresh
 * boundary (EventSource has no interceptor to refresh-and-retry), which is why the first
 * attempt is seconds, not the minute the relay used to sit blind for.
 */
export const watchRetryDelayMs = (attempt: number, random = Math.random): number => {
    const capped = Math.min(WATCH_RETRY_BASE_MS * 2 ** Math.max(0, attempt), WATCH_RETRY_MAX_MS)
    return Math.round(capped * (0.5 + random() / 2))
}
