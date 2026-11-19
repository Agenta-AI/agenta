import {useCallback, useMemo} from "react"

import {agentWorkflowsListQueryStateAtom} from "@agenta/entities/workflow"
import {useAtomValue} from "jotai"

/** The agent's row from the project's agent list, and a name lookup for its channel apps. */
export const useAgentRow = (agentId: string) => {
    const agents = useAtomValue(agentWorkflowsListQueryStateAtom)
    const list = useMemo(() => agents.data ?? [], [agents.data])
    const row = list.find((candidate) => candidate.id === agentId)
    const resolveAgentName = useCallback(
        (id: string) => {
            const match = list.find((candidate) => candidate.id === id)
            return match ? match.name || match.slug || null : null
        },
        [list],
    )
    return {row, resolveAgentName}
}
