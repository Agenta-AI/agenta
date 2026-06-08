/**
 * Param types for the EvaluationScenario api / molecule.
 */

export interface EvaluationScenarioListParams {
    projectId: string
    runId: string
    /** Windowing limit; scenarios are fetched per-run. */
    limit?: number
}

export interface EvaluationScenarioStatusInput {
    id: string
    status: string
}

export interface SetEvaluationScenarioStatusesParams {
    projectId: string
    scenarios: EvaluationScenarioStatusInput[]
}

/** Molecule family key — scenarios are scoped to a run within a project. */
export interface ScenarioListKey {
    projectId: string
    runId: string
}
