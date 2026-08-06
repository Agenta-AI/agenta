import {useMemo} from "react"

import {NextTriggersSection} from "@agenta/entity-ui/agent"
import {useAtomValue} from "jotai"

import {agentsWorkflowsAtom} from "@/oss/components/pages/agents/store"

/**
 * App adapter over the package section: the classified agents list is app state, so the app
 * resolves the display names and hands them over.
 */
const NextTriggers = ({agentId}: {agentId?: string} = {}) => {
    const agents = useAtomValue(agentsWorkflowsAtom)
    const agentNames = useMemo(
        () => new Map(agents.map((agent) => [agent.workflowId, agent.name])),
        [agents],
    )
    return <NextTriggersSection agentId={agentId} agentNames={agentNames} />
}

export default NextTriggers
