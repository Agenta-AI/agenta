/**
 * Testset Entity Types
 *
 * TypeScript interfaces for API parameters and internal types.
 */

// ============================================================================
// API PARAMETER TYPES
// ============================================================================

/**
 * List params for fetching revisions
 */
export interface RevisionListParams {
    projectId: string
    testsetId: string
}

/**
 * Detail params for fetching a single revision
 */
export interface RevisionDetailParams {
    id: string
    projectId: string
}

/**
 * List params for fetching testsets
 */
export interface TestsetListParams {
    projectId: string
    searchQuery?: string | null
}

/**
 * Detail params for fetching a single testset
 */
export interface TestsetDetailParams {
    id: string
    projectId: string
}

/**
 * Detail params for fetching a single variant
 */
export interface VariantDetailParams {
    id: string
    projectId: string
}

// ============================================================================
// LATEST REVISION TYPES
// ============================================================================

/**
 * Latest revision info for display in testsets list
 */
export interface LatestRevisionInfo {
    revisionId: string
    version: number
    message?: string
    createdAt?: string
    author?: string
}

// ============================================================================
// MUTATION TYPES
// ============================================================================

/**
 * Column-level operations for testset revision
 */
export interface TestsetRevisionDeltaColumns {
    /** Add columns: array of column names to add */
    add?: string[]
    /** Remove columns: array of column names to remove */
    remove?: string[]
    /** Replace columns: array of [old column name, new column name] to replace */
    replace?: [string, string][]
}

/**
 * Row-level operations for testset revision
 */
export interface TestsetRevisionDeltaRows {
    /** Add rows: array of testcases to add */
    add?: {data: Record<string, unknown>}[]
    /** Remove rows: array of testcase IDs to remove */
    remove?: string[]
    /** Replace rows: array of testcases to replace */
    replace?: {id: string; data: Record<string, unknown>}[]
}

/**
 * Patch operations for testset revision
 */
export interface TestsetRevisionDelta {
    /** Row-level operations */
    rows?: TestsetRevisionDeltaRows
    /** Column-level operations */
    columns?: TestsetRevisionDeltaColumns
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

// ============================================================================
// TABLE ROW TYPES
// ============================================================================

/**
 * Raw testset row from API
 */
export interface TestsetApiRow {
    id: string
    name: string
    description?: string | null
    created_at?: string | null
    updated_at?: string | null
}

/**
 * Testset row for table display (includes revision children for expandable rows)
 */
export interface TestsetTableRow {
    id: string
    key: string
    name: string
    description?: string | null
    created_at?: string | null
    updated_at?: string | null
    /** Children rows for expandable table (revision rows) */
    children?: TestsetTableRow[]
    /** Parent testset ID for revision rows */
    testset_id?: string
    /** Version for revision rows */
    version?: number
    /** Commit message for revision rows */
    message?: string
    /** Is this a revision row (child) */
    isRevision?: boolean
    /** Skeleton indicator for loading state */
    __isSkeleton?: boolean
    /** Index signature for InfiniteTableRowBase compatibility */
    [key: string]: unknown
}

/**
 * Date range filter for testsets table
 */
export interface TestsetDateRange {
    start: string | null
    end: string | null
}

/**
 * Paginated table metadata (for table pagination display)
 */
export interface TestsetPaginatedMeta {
    total: number
    pageSize: number
    currentPage: number
    hasMore: boolean
}

/**
 * Query metadata for paginated testset store
 * Used with createPaginatedEntityStore from @agenta/ui
 */
export interface TestsetQueryMeta {
    /** Project ID - required (can be null before project is selected) */
    projectId: string | null
    searchTerm?: string
    dateCreated?: TestsetDateRange
    dateModified?: TestsetDateRange
}
