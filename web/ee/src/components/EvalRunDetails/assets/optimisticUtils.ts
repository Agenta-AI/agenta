import {current} from "immer"

import {evalAtomStore, scenarioStepFamily} from "@/oss/lib/hooks/useEvaluationRunData/assets/atoms"
import {scenarioStepLocalFamily} from "@/oss/lib/hooks/useEvaluationRunData/assets/atoms/scenarios"
import {IStepResponse} from "@/oss/lib/hooks/useEvaluationRunScenarioSteps/types"

/**
 * Merge partial step data into the optimistic cache so components can render
 * interim worker results immediately while awaiting server revalidation.
 */
export const setOptimisticStepData = async (scenarioId: string, updatedSteps: IStepResponse[]) => {
    // if (!updatedStep?.key) return
    // Write into per-scenario atom to avoid cloning the entire cache map
    evalAtomStore().set(scenarioStepLocalFamily(scenarioId), (draft: any) => {
        if (!draft) return

        updatedSteps.forEach((updatedStep) => {
            const targetStep =
                draft.invocationSteps.find((s: any) => s.key === updatedStep.key) ||
                draft.inputSteps.find((s: any) => s.key === updatedStep.key) ||
                draft.annotationSteps.find((s: any) => s.key === updatedStep.key)

            if (!targetStep) return

            Object.entries(updatedStep).forEach(([k, v]) => {
                // @ts-ignore – dynamic merge
                targetStep[k] = v as any
            })
        })
    })
}
