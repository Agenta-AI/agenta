import {ScenarioStatusMap} from "../useEvaluationRunData/types"

export interface UseInvocationResultArgs {
    scenarioId: string
    stepKey: string
    runId?: string // Optional: for multi-run support
    editorType?: "simple" | "shared"
    viewType?: "single" | "table"
}

export interface UseInvocationResult {
    trace?: any
    value?: string | object
    rawValue?: any
    messageNodes: React.ReactNode[] | null
    status?: ScenarioStatusMap[string]
    hasError?: boolean
}
