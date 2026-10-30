import {
    agentRequirementsAtomFamily,
    agentRequirementsQueryAtomFamily,
    canFixRequirement,
    modelRequirement,
} from "@agenta/entities/workflow"
import {useAtomValue} from "jotai"

export interface AgentModelSetup {
    /** A model item needs setup: the run would fail, so Send is off. */
    blocked: boolean
    /** The check is running and has not answered yet, so `blocked` is not known. */
    loading: boolean
    /** The viewer can edit the agent or sign in again. */
    canFix: boolean
}

/** The model-item part of the server's needs-setup check for one saved revision. */
export const useAgentModelSetup = (revisionId: string | null | undefined): AgentModelSetup => {
    const requirements = useAtomValue(agentRequirementsAtomFamily(revisionId ?? ""))
    const query = useAtomValue(agentRequirementsQueryAtomFamily(revisionId ?? ""))
    const requirement = requirements ? modelRequirement(requirements) : undefined
    return {
        blocked: Boolean(requirement),
        loading: query.isLoading,
        canFix: canFixRequirement(requirement),
    }
}
