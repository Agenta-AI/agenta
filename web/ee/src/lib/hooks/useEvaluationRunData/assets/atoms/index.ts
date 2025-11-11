import {atom} from "jotai"

import {setOptimisticStepData} from "@/oss/components/EvalRunDetails/assets/optimisticUtils"

import {IStepResponse} from "../../../useEvaluationRunScenarioSteps/types"

import {evaluationRunStateAtom} from "./evaluationRunStateAtom"
import {invalidateRunMetricsAtom} from "./runMetricsCache"
import {scenarioStepRefreshFamily, scenarioStepFamily} from "./scenarios"
import {evalAtomStore, setActiveStoreKey, getActiveStoreKey, jotaiStoreCache} from "./store"

// re-export store helpers
export {evalAtomStore, setActiveStoreKey, getActiveStoreKey, jotaiStoreCache}

export * from "./utils"
export {
    scenarioStepRefreshFamily,
    scenarioStepFamily,
    scenariosAtom,
    scenarioIdsAtom,
    totalCountAtom,
    evaluationScenariosDisplayAtom,
    displayedScenarioIds,
    loadableScenarioStepFamily,
    scenarioStepsAtom,
    attachBulkPrefetch,
    attachNeighbourPrefetch,
} from "./scenarios"
export * from "./bulkFetch"
export * from "./derived"
export * from "./progress"
export * from "./cache"
export * from "./evaluationRunStateAtom"

export const enrichedRunAtom = atom((get) => get(evaluationRunStateAtom).enrichedRun)
export const runIndexAtom = atom((get) => get(evaluationRunStateAtom).runIndex)

export async function revalidateScenario(scenarioId: string, updatedSteps?: IStepResponse[]) {
    // 2. apply optimistic override if requested
    if (updatedSteps) {
        setOptimisticStepData(
            scenarioId,
            updatedSteps.map((st) => ({
                ...structuredClone(st),
                status: "revalidating",
            })),
        )
    }

    // 3. bump refresh counter so the specific scenario refetches
    try {
        evalAtomStore().set(scenarioStepRefreshFamily(scenarioId), (v = 0) => v + 1)
    } catch (err) {
        console.error("[atoms] failed to bump scenario refresh counter", err)
    }

    // 4. invalidate run-level metrics so derived atoms refresh
    try {
        evalAtomStore().set(invalidateRunMetricsAtom, null)
    } catch (err) {
        console.error("[atoms] failed to invalidate run metrics", err)
    }

    // 5. return a promise that resolves when the refreshed data is available
    return evalAtomStore().get(scenarioStepFamily(scenarioId))
}
