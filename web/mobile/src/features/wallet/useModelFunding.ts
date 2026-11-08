import {useMemo} from "react"

import {agentModelCandidatesAtomFamily, workflowMolecule} from "@agenta/entities/workflow"
import {readModelConnection} from "@agenta/entity-ui/drill-in"
import {useAtomValue} from "jotai"

import {modelFunding, type ModelFunding} from "./modelFunding"

/** The agent's `ModelFunding`, or `null` while its model routes load. */
export const useModelFunding = (entityId: string): ModelFunding | null => {
    const config = useAtomValue(
        useMemo(() => workflowMolecule.selectors.configuration(entityId), [entityId]),
    )
    const candidateState = useAtomValue(agentModelCandidatesAtomFamily(true))

    return useMemo(
        () =>
            // An unloaded config has no connection yet, which would read as credit-funded.
            candidateState.status === "ready" && config
                ? modelFunding(readModelConnection(config), candidateState.candidates)
                : null,
        [candidateState, config],
    )
}
