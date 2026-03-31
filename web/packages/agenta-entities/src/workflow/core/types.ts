/**
 * Workflow Entity Types
 *
 * TypeScript interfaces for API parameters and internal types.
 * Workflows use the Workflow → Variant → Revision hierarchy at `/preview/workflows/`.
 *
 * Unlike evaluators which hardcode `is_evaluator: true`, workflow queries accept
 * optional flags to filter by any combination of `is_custom`, `is_evaluator`,
 * `is_human`, `is_chat`.
 */

import type {WorkflowQueryFlags} from "./schema"

// ============================================================================
// API PARAMETER TYPES
// ============================================================================

/**
 * Params for querying workflows list.
 * `flags` is optional — omit for all workflows, or pass specific flags to filter.
 */
export interface WorkflowListParams {
    projectId: string
    name?: string
    flags?: WorkflowQueryFlags
    /**
     * Filter by folder.
     * - `undefined` (omitted): no folder filter — returns all workflows
     * - `null`: root-level items only (folder_id IS NULL)
     * - `string`: items in the specified folder
     */
    folderId?: string | null
    includeArchived?: boolean
    windowing?: {
        order?: "ascending" | "descending"
        limit?: number
        next?: string | null
    }
}

/**
 * Params for fetching a single workflow's latest revision
 */
export interface WorkflowDetailParams {
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
export interface WorkflowReference {
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
