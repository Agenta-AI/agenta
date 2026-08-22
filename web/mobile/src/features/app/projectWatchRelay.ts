import {getApiUrl} from "@/lib/env"

/**
 * Project-wide watch endpoint — same-origin `/api` + cookie auth, consumed via native
 * EventSource. The chat screen's `sessionWatchUrl` watches ONE session; this one watches the
 * whole project, which is what tells the lists that a session was created or renamed elsewhere.
 */
export const projectWatchUrl = (projectId: string): string =>
    `${getApiUrl()}/sessions/watch?project_id=${encodeURIComponent(projectId)}`

/** Polling safety net while the combined watch is unavailable or forbidden. */
export const PROJECT_WATCH_FALLBACK_MS = 30_000

/** The project-scoped lists a watch event can invalidate. */
export type ProjectWatchList = "sessions" | "workflows"

/**
 * Which lists each event refreshes, mirroring the desktop watcher's handler map.
 *
 * `ready` refreshes both, because it fires on every (re)connect and therefore has to cover
 * everything that changed while this device was asleep or backgrounded. The two change events
 * refresh only their own list, so a busy chat does not keep re-fetching the agents list.
 */
export const PROJECT_WATCH_LISTS: Record<string, readonly ProjectWatchList[]> = {
    ready: ["sessions", "workflows"],
    "session-changed": ["sessions"],
    "workflow-changed": ["workflows"],
}
