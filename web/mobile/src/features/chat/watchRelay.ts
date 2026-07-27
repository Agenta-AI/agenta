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
