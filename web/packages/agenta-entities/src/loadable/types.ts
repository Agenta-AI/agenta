/**
 * Loadable Types
 *
 * Type definitions for loadable data sources.
 * Re-exports shared types from runnable for convenience.
 */

// Re-export shared types that loadables use
export type {
    // Testset types
    TestsetRow,
    TestsetColumn,
    // Execution types
    ExecutionStatus,
    ExecutionMetrics,
    RowExecutionResult,
    ChainProgress,
    StageExecutionResult,
    // Runnable reference
    RunnableType,
} from "../runnable/types"

// ============================================================================
// LOADABLE-SPECIFIC TYPES
// ============================================================================

/**
 * Loadable mode - local data or connected to external source
 */
export type LoadableMode = "local" | "connected"

/**
 * Loadable source type - determines which entity implementation to use
 */
export type LoadableSourceType = "testcase" | "trace"

/**
 * Connected source information
 */
export interface ConnectedSource {
    /** Source ID (e.g., revision ID) */
    id: string | null
    /** Display name (e.g., "Testset v3") */
    name: string | null
    /** Source type for dispatch */
    type: LoadableSourceType | null
}

/**
 * Linked runnable information
 */
export interface LinkedRunnable {
    /** Runnable type */
    type: "appRevision" | "evaluatorRevision" | null
    /** Runnable ID */
    id: string | null
}

/**
 * Output mapping configuration
 * Maps an output path from execution results to a testcase column
 */
export interface OutputMapping {
    /** Unique ID for this mapping */
    id: string
    /** Path in execution result data (e.g., "data.outputs.response") */
    outputPath: string
    /** Target testcase column key */
    targetColumn: string
    /** Whether this mapping creates a new column */
    isNewColumn?: boolean
}

/**
 * Full loadable state shape
 *
 * Note: Rows are NOT stored here - they live in testcaseMolecule.
 * The loadable is a view/context layer over testcase entities.
 */
export interface LoadableState {
    /** Column definitions (derived from linked runnable or explicit) */
    columns: import("../runnable/types").TestsetColumn[]
    /** Currently active row ID for editing */
    activeRowId: string | null
    /** Name for new testset (used when saving as new) */
    name: string | null
    /** Connected source ID (e.g., testset revision ID) */
    connectedSourceId: string | null
    /** Connected source display name */
    connectedSourceName: string | null
    /** Connected source type for entity dispatch (defaults to 'testcase' when connected) */
    connectedSourceType: LoadableSourceType | null
    /** Linked runnable type */
    linkedRunnableType: import("../runnable/types").RunnableType | null
    /** Linked runnable ID */
    linkedRunnableId: string | null
    /** Execution results per row */
    executionResults: Record<string, import("../runnable/types").RowExecutionResult>
    /** Output-to-column mappings for populating testcase data from execution results */
    outputMappings: OutputMapping[]
    /**
     * Testcase IDs hidden from execution UI (but NOT deleted from testset)
     * This is a UI-only filter - the testcases still exist in the testset data.
     * Used when user removes a testcase from the execution view without wanting
     * to actually delete it from the connected testset.
     */
    hiddenTestcaseIds: Set<string>
    /**
     * Row IDs where output mapping is disabled.
     * When disabled, the row displays original testcase data instead of
     * derived output values from execution results.
     */
    disabledOutputMappingRowIds: Set<string>
}
