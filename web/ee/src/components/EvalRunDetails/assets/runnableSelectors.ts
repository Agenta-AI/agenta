import deepEqual from "fast-deep-equal"
import {atom} from "jotai"
import {selectAtom, loadable, atomFamily} from "jotai/utils"

import {
    scenariosAtom,
    scenarioStatusAtomFamily,
    scenarioStepFamily,
} from "@/oss/lib/hooks/useEvaluationRunData/assets/atoms"

/**
 * IDs of scenarios that are currently runnable (i.e. have invocation parameters
 * and are not in a final/running UI state).
 */
// 1. Combine the needed state into a single base atom
// helper shallow array equality
const shallowArrayEqual = <T>(a: T[], b: T[]) =>
    a.length === b.length && a.every((v, i) => v === b[i])

// A scenario is considered runnable when:
// 1. Its overall status is not in a terminal / running state, AND
// 2. Its step data has been fetched (Loadable state === "hasData"), AND
// 3. At least one invocationStep still contains `invocationParameters` (i.e. not yet executed)
// Per-scenario memoised check – avoids re-running heavy logic for all 1000 scenarios
export const scenarioIsRunnableFamily = atomFamily(
    (scenarioId: string) =>
        atom((get) => {
            const {status} = get(scenarioStatusAtomFamily(scenarioId))
            if (["running", "done", "success", "revalidating"].includes(status)) return false
            const loadableStep = get(loadable(scenarioStepFamily(scenarioId)))
            if (loadableStep.state !== "hasData") return false
            const invSteps: any[] = loadableStep.data?.invocationSteps ?? []
            return invSteps.some((st) => !!st.invocationParameters)
        }),
    deepEqual,
)

export const runnableScenarioIdsAtom = atom((get) => {
    const scenarios = get(scenariosAtom)
    return scenarios.filter(({id}) => get(scenarioIsRunnableFamily(id))).map((s) => s.id)
})

/* memoised view that won’t re-emit if the array is the same */
export const runnableScenarioIdsMemoAtom = selectAtom(
    runnableScenarioIdsAtom,
    (ids) => ids,
    shallowArrayEqual,
)

// Boolean flag: true if at least one scenario is runnable. Uses early exit to avoid building arrays
export const hasRunnableScenarioAtom = atom((get) => {
    const scenarios = get(scenariosAtom)
    for (const {id} of scenarios) {
        if (get(scenarioIsRunnableFamily(id))) return true
    }
    return false
})
