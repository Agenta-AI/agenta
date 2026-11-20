import {useCallback, useMemo, useSyncExternalStore} from "react"

import {
    sessionTabScope,
    usePublishRenderedSessionTabs,
    useSessionCardList,
    type UseSessionCardListArgs,
} from "@agenta/sessions/state"
import {useQueryClient, type Query} from "@tanstack/react-query"

/** The session menu's list. The header reads the same list, so both share one set of requests. */
export const sessionMenuListArgs = (agentId: string | null): UseSessionCardListArgs => ({
    policy: {origin: "exclude-trigger", expansions: []},
    agentId: agentId ?? undefined,
    limit: 20,
    withPinned: true,
})

/** A failed session-list request of this agent (the recent, pinned or waiting part). */
const failedListOf = (agentId: string | null) => (query: Query) =>
    query.queryKey[0] === "session-list" &&
    query.queryKey.includes(agentId ?? undefined) &&
    query.state.status === "error"

/**
 * The agent's sessions in the session menu's order, published where the session tab strip
 * published its tabs. Removing the open session (archive, delete) then moves to the next one, as
 * it did with the strip. Also tells the menu whether one of its requests failed, and retries those.
 */
export const useAgentSessionOrder = (agentId: string | null) => {
    const queryClient = useQueryClient()
    const list = useSessionCardList(sessionMenuListArgs(agentId))
    const ids = useMemo(
        () => list.groups.flatMap((group) => group.rows.map((row) => row.id)),
        [list.groups],
    )
    usePublishRenderedSessionTabs(sessionTabScope(agentId), ids)

    const cache = queryClient.getQueryCache()
    const failed = useSyncExternalStore(
        (notify) => cache.subscribe(notify),
        () => cache.findAll({predicate: failedListOf(agentId)}).length > 0,
        () => false,
    )
    const retry = useCallback(
        () => void queryClient.refetchQueries({predicate: failedListOf(agentId)}),
        [queryClient, agentId],
    )
    return {failed, retry}
}
