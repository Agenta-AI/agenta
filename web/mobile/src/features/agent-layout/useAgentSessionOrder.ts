import {useEffect, useMemo} from "react"

import {
    renderedSessionTabsAtomFamily,
    rowsFromPages,
    sessionTabScope,
    useSessionList,
} from "@agenta/sessions/state"
import {useSetAtom} from "jotai"

/**
 * The agent's latest sessions, in list order, published where the session tab strip published its
 * tabs. Removing the open session (archive, delete) then moves to the next one, as it did with the
 * strip. Also tells the session menu whether the list failed to load.
 */
export const useAgentSessionOrder = (agentId: string | null) => {
    const query = useSessionList({
        originPolicy: "exclude-trigger",
        expansions: [],
        agentId: agentId ?? undefined,
        enabled: Boolean(agentId),
        lowPriority: true,
    })
    const ids = useMemo(
        () => rowsFromPages(query.data?.pages).map((row) => row.session_id),
        [query.data?.pages],
    )
    const publish = useSetAtom(renderedSessionTabsAtomFamily(sessionTabScope(agentId)))
    useEffect(() => {
        publish(ids)
    }, [ids, publish])
    return {failed: query.isError && ids.length === 0, retry: () => void query.refetch()}
}
