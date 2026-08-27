import {useMemo} from "react"

import {invalidateSessionListQueries} from "@agenta/entities/session"
import {invalidateWorkflowsListCache} from "@agenta/entities/workflow"
import {getAgentaApiUrl, getHostQueryClient} from "@agenta/shared/api"
import {projectIdAtom} from "@agenta/shared/state"
import {useAtomValue} from "jotai"

import {useWatchEventSource, type RefreshSession} from "./watchEventSource"

/** The events `GET /sessions/watch` emits. `ready` fires on every (re)connect. */
export type ProjectWatchEvent = "ready" | "session-changed" | "workflow-changed"

export const projectWatchUrl = (projectId: string): string =>
    `${getAgentaApiUrl()}/sessions/watch?project_id=${encodeURIComponent(projectId)}`

/**
 * Every project-scoped workflow list, on whichever host is asking.
 *
 * `invalidateWorkflowsListCache` covers the keys the packages own (`["workflows", "apps"]` and
 * `["workflows", "artifact"]`) — the sidebar, `/m`'s agents list, and the artifact metadata a
 * rename changes. The desktop agents TABLE predates them and keys on `agents-workflows`, which
 * exists only there; a token match reaches it without importing an app module into a package,
 * and matches nothing on `/m`.
 */
const invalidateProjectWorkflowQueries = (): void => {
    invalidateWorkflowsListCache()
    void getHostQueryClient().invalidateQueries({
        predicate: (query) => query.queryKey.includes("agents-workflows"),
    })
}

/**
 * The project's live revalidation channel: one SSE stream per foregrounded app, mapping server
 * change events onto the shared invalidators.
 *
 * This is the ONLY thing that tells a project list the server moved. The lists themselves are
 * cached with a stale time and no interval, so without this mount a session created (or finished)
 * anywhere — including in this app's own chat — surfaces only when a remount happens to find the
 * cache expired. That is the navigate-away-and-come-back dance.
 *
 * `ready` refreshes both lists because it fires on every reconnect and has to cover whatever
 * changed while the stream was down (a phone that was asleep, a backend that restarted). The two
 * change events stay narrow, so a busy chat does not refetch the agents list on every turn.
 */
export const useProjectWatch = ({refreshSession}: {refreshSession: RefreshSession}): void => {
    const projectId = useAtomValue(projectIdAtom)
    const url = projectId ? projectWatchUrl(projectId) : null

    const handlers = useMemo(
        (): Record<ProjectWatchEvent, () => void> => ({
            ready: () => {
                invalidateSessionListQueries()
                invalidateProjectWorkflowQueries()
            },
            "session-changed": invalidateSessionListQueries,
            "workflow-changed": invalidateProjectWorkflowQueries,
        }),
        [],
    )

    useWatchEventSource({url, on: handlers, refreshSession})
}
