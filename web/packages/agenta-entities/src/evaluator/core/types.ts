/**
 * Evaluator Entity Types
 *
 * TypeScript interfaces for API parameters and internal types.
 * Evaluators use the Workflow → Variant → Revision hierarchy at `/preview/workflows/`.
 * List queries return workflows; detail fetches return the latest revision (with data).
 */

// ============================================================================
// API PARAMETER TYPES
// ============================================================================

/**
 * Params for querying evaluators list
 */
export interface EvaluatorListParams {
    projectId: string
    searchQuery?: string | null
    includeArchived?: boolean
}

/**
 * Params for fetching a single evaluator
 */
export interface EvaluatorDetailParams {
    id: string
    projectId: string
}

// ============================================================================
// REFERENCE TYPE
// ============================================================================

/**
 * Reference object used in query requests
 * Matches backend `Reference(Identifier, Slug, Version)`
 */
export interface EvaluatorReference {
    id?: string
    slug?: string
    version?: string
}

// ============================================================================
// QUERY RESULT TYPES
// ============================================================================

/**
 * Generic query result type matching TanStack Query patterns
 */
export interface QueryResult<T> {
    data: T | null
    isPending: boolean
    isError: boolean
    error: Error | null
}
