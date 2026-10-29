import {
    agentRequirementsAtomFamily,
    canFixRequirement,
    modelRequirement,
    type AgentRequirementItem,
} from "@agenta/entities/workflow"
import {useAtomValue} from "jotai"

export interface AgentModelSetup {
    /** A model item needs setup: the run would fail, so Send is off. */
    blocked: boolean
    requirement: AgentRequirementItem | null
    /** The viewer can edit the agent or sign in again. */
    canFix: boolean
}

/** The model-item part of the server's needs-setup check for one saved revision. */
export const useAgentModelSetup = (revisionId: string | null | undefined): AgentModelSetup => {
    const requirements = useAtomValue(agentRequirementsAtomFamily(revisionId ?? ""))
    const requirement = (requirements && modelRequirement(requirements)) || null
    return {
        blocked: Boolean(requirement),
        requirement,
        canFix: canFixRequirement(requirement ?? undefined),
    }
}
