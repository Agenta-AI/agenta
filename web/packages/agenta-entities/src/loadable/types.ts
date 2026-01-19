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
 * Connected source information
 */
export interface ConnectedSource {
    /** Source ID (e.g., revision ID) */
    id: string | null
    /** Display name (e.g., "Testset v3") */
    name: string | null
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
 * Full loadable state shape
 */
export interface LoadableState {
    rows: import("../runnable/types").TestsetRow[]
    columns: import("../runnable/types").TestsetColumn[]
    activeRowId: string | null
    connectedSourceId: string | null
    connectedSourceName: string | null
    linkedRunnableType: import("../runnable/types").RunnableType | null
    linkedRunnableId: string | null
    executionResults: Record<string, import("../runnable/types").RowExecutionResult>
}
