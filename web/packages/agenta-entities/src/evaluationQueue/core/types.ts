/**
 * EvaluationQueue Entity Types
 *
 * TypeScript interfaces for API parameters and internal types.
 */

// ============================================================================
// API PARAMETER TYPES
// ============================================================================

/**
 * Params for querying the evaluation queues list
 */
export interface EvaluationQueueListParams {
    projectId: string
    runId?: string | null
    userId?: string | null
}

/**
 * Params for fetching a single evaluation queue
 */
export interface EvaluationQueueDetailParams {
    id: string
    projectId: string
}
