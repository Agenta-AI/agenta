import {builderAgentWorkflowIdAtom} from "@agenta/entities/workflow"
import {getDefaultStore} from "jotai"

/**
 * Whether `agentId` is the builder's workflow id. Read from the store at call time: the main
 * sidebar lists the builder's sessions only after that id has loaded, so a builder row or heading
 * never exists before it does.
 */
export const isBuilderAgent = (agentId: string | null | undefined): boolean =>
    Boolean(agentId) && agentId === getDefaultStore().get(builderAgentWorkflowIdAtom)
