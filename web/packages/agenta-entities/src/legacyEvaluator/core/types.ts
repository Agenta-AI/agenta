/**
 * LegacyEvaluator Entity Types
 *
 * TypeScript interfaces for API parameters and internal types.
 * LegacyEvaluators use the SimpleEvaluator facade API at `/preview/simple/evaluators/`.
 * The SimpleEvaluator API flattens the Artifact → Variant → Revision hierarchy
 * into a single entity.
 */

// ============================================================================
// API PARAMETER TYPES
// ============================================================================

/**
 * Params for querying evaluators list
 */
export interface LegacyEvaluatorListParams {
    projectId: string
    includeArchived?: boolean
}

/**
 * Params for fetching a single evaluator
 */
export interface LegacyEvaluatorDetailParams {
    id: string
    projectId: string
}

// ============================================================================
// REFERENCE TYPE
// ============================================================================

/**
 * Reference object used in query requests.
 * Matches backend `Reference(Identifier, Slug, Version)`.
 */
export interface LegacyEvaluatorReference {
    id?: string
    slug?: string
    version?: string
}
