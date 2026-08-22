import {getApiUrl} from "@/lib/env"

/**
 * Project-wide watch endpoint — same-origin `/api` + cookie auth, consumed via native
 * EventSource. The chat screen's `sessionWatchUrl` watches ONE session; this one watches the
 * whole project, which is what tells the lists that a session was created, renamed or finished
 * somewhere else.
 */
export const projectWatchUrl = (projectId: string): string =>
    `${getApiUrl()}/sessions/watch?project_id=${encodeURIComponent(projectId)}`
