import {useMemo} from "react"

import {projectIdAtom} from "@agenta/shared/state"
import {useAtomValue} from "jotai"

import {sessionOpenTarget} from "../row/sessionOpenTarget"

import {
    pendingBySessionId,
    rowsFromPages,
    useActionableInteractions,
    useSessionList,
} from "./useSessionList"

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
        sessionIds: waitingIds,
        // An automation run that needs approval still belongs to the agent that ran it.
        showTriggered: true,
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
