import {useMemo} from "react"

import {useAtomValue} from "jotai"
import {loadable} from "jotai/utils"

import {UseEvaluationRunScenarioStepsFetcherResult} from "../useEvaluationRunScenarioSteps/types"

import {getCurrentRunId} from "./assets/atoms/migrationHelper"
import {scenarioStepFamily} from "./assets/atoms/runScopedScenarios"
import {evalAtomStore} from "./assets/atoms/store"

const useEvalRunScenarioData = (scenarioId: string, runId?: string) => {
    const store = evalAtomStore()

    // Memoize runId calculation to prevent infinite loops
    const effectiveRunId = useMemo(() => {
        if (runId) return runId
        try {
            return getCurrentRunId()
        } catch (error) {
            console.warn("[useEvalRunScenarioData] No run ID available:", error)
            return null
        }
    }, [runId])

    // Read from the same global store that writes are going to
    const stepLoadable = useAtomValue(
        loadable(scenarioStepFamily({scenarioId, runId: effectiveRunId || ""})),
        {store},
    )

    return useMemo(() => {
        let data: UseEvaluationRunScenarioStepsFetcherResult | undefined =
            stepLoadable.state === "hasData" ? stepLoadable.data : undefined

        if (stepLoadable.state === "hasData" && stepLoadable.data?.trace) {
            data = stepLoadable.data
        }
        return data
    }, [stepLoadable])
}

export default useEvalRunScenarioData
