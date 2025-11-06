import type {EvaluationLoadingState, EvaluationRunState, IStatusMeta} from "../types"

export const initialState: EvaluationRunState = {
    rawRun: undefined,
    isPreview: undefined,
    enrichedRun: undefined,
    isComparison: false,
    isBase: false,
    compareIndex: undefined,
    colorIndex: undefined,
    scenarios: undefined,
    statusMeta: {} as IStatusMeta,
    steps: undefined,
    metrics: undefined,
    isLoading: {run: false, scenarios: false, steps: false, metrics: false},
    isError: {run: false, scenarios: false, steps: false, metrics: false},
}

export const defaultLoadingState: EvaluationLoadingState = {
    isLoadingEvaluation: true,
    isLoadingScenarios: false,
    isLoadingSteps: false,
    isLoadingMetrics: false,
    isRefreshingMetrics: false,
    activeStep: null,
    scenarioStepProgress: {completed: 0, total: 0, percent: 0},
}
