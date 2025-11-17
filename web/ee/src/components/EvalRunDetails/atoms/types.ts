import type {RunIndex} from "@/oss/lib/hooks/useEvaluationRunData/assets/helpers/buildRunIndex"
import type {IStepResponse} from "@/oss/lib/hooks/useEvaluationRunScenarioSteps/types"
import type {EvaluationRun} from "@/agenta-oss-common/lib/hooks/usePreviewEvaluations/types"
import type {SnakeToCamelCaseKeys} from "@/oss/lib/Types"

export type PreviewEvaluationRun = SnakeToCamelCaseKeys<EvaluationRun>

export interface PreviewEvaluationRunQueryData {
    rawRun: EvaluationRun
    run: PreviewEvaluationRun
    runIndex: RunIndex
    testsetIds: string[]
}

export interface PreviewScenarioSummary {
    id: string
    runId: string
    status: string
    createdAt?: string
    updatedAt?: string
    createdById?: string
    updatedById?: string
}

export interface PreviewScenarioListQueryData {
    count: number
    scenarios: PreviewScenarioSummary[]
}

export interface ScenarioStepsBatchResult {
    scenarioId: string
    steps: IStepResponse[]
    count: number
    next?: string
}
