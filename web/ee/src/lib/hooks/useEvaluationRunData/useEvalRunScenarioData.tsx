import {useMemo} from "react"

import {getCurrentRunId} from "./assets/atoms/migrationHelper"
import {hasScenarioStepData, useScenarioStepSnapshot} from "./useScenarioStepSnapshot"

const useEvalRunScenarioData = (scenarioId: string, runId?: string) => {
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

    const snapshot = useScenarioStepSnapshot(scenarioId, effectiveRunId)

    return useMemo(() => {
        const data = snapshot.data
        if (hasScenarioStepData(data)) return data
        return undefined
    }, [snapshot])
}

export default useEvalRunScenarioData
