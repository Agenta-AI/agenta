import deepEqual from "fast-deep-equal"
import {atom} from "jotai"
import {selectAtom, loadable, atomFamily} from "jotai/utils"

import {
    scenariosFamily,
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
    (params: {scenarioId: string; runId: string}) =>
        atom((get) => {
            const {status} = get(scenarioStatusAtomFamily(params))
            if (["running", "done", "success", "revalidating"].includes(status)) return false
            const loadableStep = get(loadable(scenarioStepFamily(params)))
            if (loadableStep.state !== "hasData") return false
            const invSteps: any[] = loadableStep.data?.invocationSteps ?? []
            return invSteps.some((st) => !!st.invocationParameters)
        }),
    deepEqual,
)

export const runnableScenarioIdsFamily = atomFamily((runId: string) => {
    return atom((get) => {
        const scenarios = get(scenariosFamily(runId))
        return scenarios
            .filter((scenario: any) =>
                get(scenarioIsRunnableFamily({scenarioId: scenario.id, runId})),
            )
            .map((s: any) => s.id)
    })
}, deepEqual)

/* memoised view that won’t re-emit if the array is the same */
export const runnableScenarioIdsMemoFamily = atomFamily((runId: string) => {
    return selectAtom(runnableScenarioIdsFamily(runId), (ids) => ids, shallowArrayEqual)
}, deepEqual)

// Boolean flag: true if at least one scenario is runnable. Uses early exit to avoid building arrays
export const hasRunnableScenarioFamily = atomFamily((runId: string) => {
    return atom((get) => {
        const scenarios = get(scenariosFamily(runId))
        for (const scenario of scenarios) {
            if (get(scenarioIsRunnableFamily({scenarioId: (scenario as any).id, runId})))
                return true
        }
        return false
    })
}, deepEqual)
