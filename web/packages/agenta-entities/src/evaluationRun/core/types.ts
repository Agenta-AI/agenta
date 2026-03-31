/**
 * EvaluationRun Entity Types
 *
 * TypeScript interfaces for API parameters.
 */

// ============================================================================
// API PARAMETER TYPES
// ============================================================================

/**
 * Params for fetching a single evaluation run by ID.
 */
export interface EvaluationRunDetailParams {
    id: string
    projectId: string
}

/**
 * Params for querying multiple evaluation runs.
 */
export interface EvaluationRunQueryParams {
    projectId: string
    ids?: string[]
}

/**
 * Params for querying evaluation results (scenario steps).
 */
export interface EvaluationResultsQueryParams {
    projectId: string
    runId: string
    scenarioIds?: string[]
    stepKeys?: string[]
}
