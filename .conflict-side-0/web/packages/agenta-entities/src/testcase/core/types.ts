/**
 * Testcase Types
 *
 * TypeScript interfaces for API parameters and internal types.
 */

import type {Testcase} from "./schema"

// ============================================================================
// API PARAMETER TYPES
// ============================================================================

/**
 * Parameters for fetching a single testcase
 */
export interface TestcaseDetailParams {
    projectId: string
    testcaseId: string
}

/**
 * Parameters for fetching testcases by revision
 */
export interface TestcaseListParams {
    projectId: string
    revisionId: string
    cursor?: string | null
    limit?: number
}

/**
 * Parameters for batch fetching testcases
 */
export interface TestcaseBatchParams {
    projectId: string
    testcaseIds: string[]
}

// ============================================================================
// COLUMN TYPES
// ============================================================================

/**
 * Column definition for testcase table
 */
export interface Column {
    /** Column key (field name or full path for expanded columns) */
    key: string
    /** Display label (defaults to key) */
    label?: string
    /** Parent column key (for grouped/expanded columns) */
    parentKey?: string
    /** Column width in pixels */
    width?: number
    /** Whether column is sortable */
    sortable?: boolean
    /** Whether column is from server or locally added */
    isLocal?: boolean
}

/**
 * Type alias for testcase-specific column
 * Same as Column but semantically indicates testcase usage
 */
export type TestcaseColumn = Column

/**
 * Expanded column for nested object fields
 *
 * When a column contains an object, it can be expanded to show
 * nested properties as separate columns.
 */
export interface ExpandedColumn {
    /** Parent column key */
    parentKey: string
    /** Full path (e.g., "inputs.code") */
    fullPath: string
    /** Nested key within parent */
    nestedKey: string
    /** Display label */
    label: string
}

// ============================================================================
// QUERY RESULT TYPES
// ============================================================================

/**
 * Query result with loading/error states
 */
export interface QueryResult<T> {
    data: T | null
    isPending: boolean
    isError: boolean
    error: Error | null
}

/**
 * Page result for paginated queries
 *
 * Note: Testcases are stored in nested format (with `data` property).
 * Cell values are accessed via `testcase.data[columnKey]`.
 */
export interface TestcasesPage {
    testcases: Testcase[]
    count: number
    nextCursor: string | null
    hasMore: boolean
}

// ============================================================================
// TESTSET METADATA TYPES
// ============================================================================

/**
 * Testset metadata for display
 */
export interface TestsetMetadataInfo {
    testsetId: string
    testsetName: string
    testsetSlug?: string
    revisionSlug?: string
    revisionVersion?: number
    description?: string
    commitMessage?: string
    author?: string
    createdAt?: string
    updatedAt?: string
}

// ============================================================================
// INTERNAL TYPES
// ============================================================================

/**
 * Cell accessor key
 */
export interface CellKey {
    id: string
    column: string
}

/**
 * Batch update entry
 *
 * Note: Updates are applied to the nested `data` property of a Testcase.
 */
export interface BatchUpdateEntry {
    id: string
    updates: {data?: Record<string, unknown>}
}

/**
 * Column rename operation
 */
export interface ColumnRenameOperation {
    oldKey: string
    newKey: string
    rowDataMap?: Map<string, Record<string, unknown>>
}
