import {useMemo} from "react"

import {sessionListQueryOptions, sessionRowsFromPages} from "@agenta/entities/session"
import {useActionableInteractions} from "@agenta/sessions/state"
import {keepPreviousData, useQuery} from "@tanstack/react-query"

import {
    childApprovalsOf,
    otherWaitingSessionIds,
    sessionIdBatches,
    type ChildApprovals,
} from "./childApprovals"

/**
 * The approvals that the child sessions of the open chat wait on.
 *
 * No request of its own on a schedule: the project's actionable interactions are the one shared
 * flight that the waiting badges already read (its own cadence, the session watch invalidates
 * it). The ids of the other waiting sessions go to the server as a `session_ids` pushdown, one
 * request per batch of the server's page limit, and the rows say which of them this session
 * created (`calling_session`). The structured part of a child update is not used: it leaves the
 * queue when its turn runs, and the transcript does not keep it.
 */
export const useChildApprovals = ({
    sessionId,
    projectId,
}: {
    sessionId: string
    projectId: string
}): ChildApprovals[] => {
    const interactions = useActionableInteractions(projectId)
    const waitingIds = useMemo(
        () => otherWaitingSessionIds(interactions.data, sessionId),
        [interactions.data, sessionId],
    )
    const waiting = useQuery({
        // Under the "session-list" token, so a session change (an archive, a rename) that
        // invalidates the lists reads these rows again.
        queryKey: ["session-list", projectId, "child-approvals", waitingIds],
        // Every origin: a child session has the origin `calling_session`, which the default
        // lists leave out.
        queryFn: async ({signal}) => {
            const pages = await Promise.all(
                sessionIdBatches(waitingIds).map((ids) =>
                    sessionListQueryOptions({
                        projectId,
                        sessionIds: ids,
                        limit: ids.length,
                    }).queryFn({signal}),
                ),
            )
            // The fetcher answers a failed read with null. Throw, so the query retries and keeps
            // the last rows instead of reading the failure as "no children".
            if (pages.some((page) => page === null)) throw new Error("waiting sessions read failed")
            return pages
        },
        enabled: Boolean(projectId) && waitingIds.length > 0,
        // The rows of the previous id set stay correct while a new set resolves: the session
        // that created a row never changes, and the current interactions decide what waits. So
        // the cards do not unmount (and lose a typed note) when another session starts waiting.
        placeholderData: keepPreviousData,
        staleTime: 30_000,
        // /m turns focus refetch off app-wide; on, as the session list has it, so a read that
        // failed every retry comes back when the person returns to the tab.
        refetchOnWindowFocus: true,
    })
    const noneWaiting = waitingIds.length === 0
    return useMemo(
        () =>
            noneWaiting
                ? []
                : childApprovalsOf({
                      interactions: interactions.data,
                      sessions: sessionRowsFromPages(waiting.data),
                      sessionId,
                  }),
        [noneWaiting, interactions.data, waiting.data, sessionId],
    )
}
