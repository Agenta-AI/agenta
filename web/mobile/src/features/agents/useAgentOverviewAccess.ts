import {useMemo} from "react"

import {
    agentWorkflowsListQueryStateAtom,
    retrieveWorkflowRevision,
    type Workflow,
} from "@agenta/entities/workflow"
import {userAtom} from "@agenta/shared/state"
import {useQuery} from "@tanstack/react-query"
import {useAtomValue} from "jotai"

import {isMyPrivateAgent} from "./myPrivateAgent"

/**
 * What the agent overview may show (QA D6). The agent list row is the common source. An id the
 * list does not hold (hidden, unknown, or archived) is looked up once by its latest revision: the
 * server answers a hidden agent like an unknown one, so `notFound` is the one not-found screen
 * for both, and an archived agent the reader can see still opens.
 */
export const useAgentOverviewAccess = ({
    agentId,
    projectId,
}: {
    agentId: string
    projectId: string
}) => {
    const me = useAtomValue(userAtom)
    const agentsQuery = useAtomValue(agentWorkflowsListQueryStateAtom)
    const agent = useMemo<Workflow | undefined>(
        () => (agentsQuery.data ?? []).find((candidate) => candidate.id === agentId),
        [agentsQuery.data, agentId],
    )
    const listed = Boolean(agent)
    const listLoaded = !agentsQuery.isPending && agentsQuery.data !== undefined
    const lookup = useQuery({
        queryKey: ["agent-overview-lookup", projectId, agentId],
        queryFn: async () =>
            (await retrieveWorkflowRevision({projectId, workflowRef: {id: agentId}})) ?? null,
        enabled: Boolean(projectId && agentId) && listLoaded && !listed,
        staleTime: 30_000,
    })
    return {
        agent,
        notFound: !listed && lookup.isSuccess && !lookup.data?.id,
        agentPrivate: isMyPrivateAgent(agent, me?.id),
    }
}
