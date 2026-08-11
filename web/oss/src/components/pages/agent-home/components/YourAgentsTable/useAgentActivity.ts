import {useMemo} from "react"

import {
    pendingBySessionId,
    rowsFromPages,
    useActionableInteractions,
    useSessionList,
} from "@agenta/sessions/state"
import {useAtomValue} from "jotai"

import {sessionOpenTarget} from "@/oss/components/AgentChatSlice/assets/sessionOpenTarget"
import {sessionListPolicies} from "@/oss/lib/sessionListPolicies"
import {projectIdAtom} from "@/oss/state/project"

/**
 * How many of each agent's sessions are blocked on a human, keyed by workflow id.
 *
 * One request for the whole table: the project-wide gate poll supplies the ids, which go back to
 * the server as a `session_ids` pushdown, and each returned row names its agent through the
 * latest turn's references. Counting from a windowed page instead would undercount any agent
 * whose blocked session fell outside it.
 */
export function useWaitingByAgent(): Map<string, number> {
    const projectId = useAtomValue(projectIdAtom) ?? ""
    const interactions = useActionableInteractions(projectId)

    const waitingIds = useMemo(() => {
        const pending = pendingBySessionId(interactions.data)
        return pending ? [...pending.keys()] : []
    }, [interactions.data])

    const waitingQuery = useSessionList({
        originPolicy: sessionListPolicies.agentActivity.origin,
        expansions: sessionListPolicies.agentActivity.expansions,
        sessionIds: waitingIds,
        enabled: waitingIds.length > 0,
    })

    return useMemo(() => {
        const counts = new Map<string, number>()
        for (const row of rowsFromPages(waitingQuery.data?.pages)) {
            const appId = sessionOpenTarget(row)?.appId
            if (appId) counts.set(appId, (counts.get(appId) ?? 0) + 1)
        }
        return counts
    }, [waitingQuery.data?.pages])
}

/**
 * The agent's most recent session, whenever it ran.
 *
 * One row's worth of the server's own activity ordering — exact rather than derived from whatever
 * happened to be in the list's window. This is one single-row request per roster row; the roster
 * is a short, stable table, so it stays cheap where the session list (long, polling) would not.
 */
export function useAgentLastSession(agentId: string) {
    const query = useSessionList({
        originPolicy: sessionListPolicies.agentActivity.origin,
        expansions: sessionListPolicies.agentActivity.expansions,
        agentId,
        limit: 1,
        enabled: Boolean(agentId),
    })
    const rows = rowsFromPages(query.data?.pages)

    return {
        session: rows[0] ?? null,
        isPending: query.isPending,
    }
}
