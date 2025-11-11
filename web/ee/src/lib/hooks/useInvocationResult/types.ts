import {ScenarioStatusMap} from "../useEvaluationRunData/types"

export interface UseInvocationResultArgs {
    scenarioId: string
    stepKey: string
}

export interface UseInvocationResult {
    trace?: any
    value?: string | object
    rawValue?: any
    messageNodes: React.ReactNode[] | null
    status?: ScenarioStatusMap[string]
}
