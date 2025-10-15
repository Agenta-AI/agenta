// Import run-scoped version for multi-run support
import {
    scenarioStepLocalFamily,
    evalAtomStore,
} from "@/oss/lib/hooks/useEvaluationRunData/assets/atoms"
import {IStepResponse} from "@/oss/lib/hooks/useEvaluationRunScenarioSteps/types"

/**
 * Merge partial step data into the optimistic cache so components can render
 * interim worker results immediately while awaiting server revalidation.
 */
export const setOptimisticStepData = async (
    scenarioId: string,
    updatedSteps: IStepResponse[],
    runId?: string,
) => {
    // Write into per-scenario atom to avoid cloning the entire cache map
    // Skip if no runId provided since run-scoped atoms require it
    if (!runId) {
        console.warn("[setOptimisticStepData] No runId provided, skipping optimistic update")
        return
    }

    evalAtomStore().set(scenarioStepLocalFamily({runId, scenarioId}), (draft: any) => {
        if (!draft) return

        updatedSteps.forEach((updatedStep) => {
            const targetStep =
                draft.invocationSteps?.find((s: any) => s.stepKey === updatedStep.stepKey) ||
                draft.inputSteps?.find((s: any) => s.stepKey === updatedStep.stepKey) ||
                draft.annotationSteps?.find((s: any) => s.stepKey === updatedStep.stepKey)

            if (!targetStep) return

            Object.entries(updatedStep).forEach(([k, v]) => {
                // @ts-ignore – dynamic merge
                targetStep[k] = v as any
            })
        })
    })
}
