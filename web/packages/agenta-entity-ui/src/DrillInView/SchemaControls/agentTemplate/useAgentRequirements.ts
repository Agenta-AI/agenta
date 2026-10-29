import {agentRequirementsAtomFamily, type AgentRequirementItem} from "@agenta/entities/workflow"
import {useAtomValue} from "jotai"

import {useOptionalDrillIn} from "../../components/MoleculeDrillInContext"

/** The open revision's needs-setup requirements; `null` until the server answered. */
export const useAgentRequirements = (): AgentRequirementItem[] | null => {
    const drillIn = useOptionalDrillIn<unknown>()
    const requirements = useAtomValue(agentRequirementsAtomFamily(drillIn?.entityId ?? ""))
    return Array.isArray(requirements) ? requirements : null
}
