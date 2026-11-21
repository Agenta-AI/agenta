import {useMemo} from "react"

import {rowsFromPages, useActionableInteractions, useSessionList} from "@agenta/sessions/state"

import {childApprovalsOf, otherWaitingSessionIds, type ChildApprovals} from "./childApprovals"

/**
 * The approvals that the child sessions of the open chat wait on.
 *
 * No request of its own on a schedule: the project's actionable interactions are the one shared
 * flight that the waiting badges already read (its own cadence, the session watch invalidates
 * it). The ids of the other waiting sessions go to the server as a `session_ids` pushdown, and
 * the rows say which of them this session created (`calling_session`). The structured part of a
 * child update is not used: it leaves the queue when its turn runs, and the transcript does not
 * keep it.
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
    const waiting = useSessionList({
        sessionIds: waitingIds,
        // A child session has the origin `calling_session`, which the default lists leave out.
        originPolicy: "all",
        expansions: [],
        enabled: waitingIds.length > 0,
    })
    const noneWaiting = waitingIds.length === 0
    // The list keeps the previous id set's rows while a new one resolves; those may name a
    // child that no longer waits.
    const stale = waiting.isPlaceholderData
    return useMemo(
        () =>
            noneWaiting || stale
                ? []
                : childApprovalsOf({
                      interactions: interactions.data,
                      sessions: rowsFromPages(waiting.data?.pages),
                      sessionId,
                  }),
        [noneWaiting, stale, interactions.data, waiting.data?.pages, sessionId],
    )
}
