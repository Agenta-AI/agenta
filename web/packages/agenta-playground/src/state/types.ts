/**
 * Playground State Types
 *
 * Re-exports types from @agenta/entities/runnable to avoid duplication.
 * This ensures type consistency and avoids circular dependencies.
 *
 * Also defines playground-specific view model types that transform
 * entity data for UI consumption.
 */

import type {ChainExecutionProgress, StageExecutionResult} from "@agenta/entities/runnable"

// Re-export all types from entities
export type {
    // Entity types
    EntityType,
    RunnableType,
    EntitySelection,
    EntitySelectorConfig,
    // Node types
    PlaygroundNode,
    ExtraColumn,
    ConnectedTestset,
    // Connection types
    InputMappingStatus,
    InputMapping,
    OutputConnection,
    // Testset types
    TestsetRow,
    TestsetColumn,
    // Execution types
    ExecutionStatus,
    TraceInfo,
    ExecutionMetrics,
    ExecutionResult,
    StageExecutionResult,
    ChainProgress,
    ChainExecutionProgress,
    RowExecutionResult,
    // Runnable types
    RunnableInputPort,
    RunnableOutputPort,
    RunnableData,
    EvaluatorRevisionData,
    // Path types
    PathInfo,
    ExtendedPathInfo,
    PathItem,
    // State types
    PlaygroundState,
    PlaygroundAction,
} from "@agenta/entities/runnable"

// ============================================================================
// PLAYGROUND VIEW MODEL TYPES
// ============================================================================
// These types are playground-specific transformations of entity data for UI.

/**
 * Chain execution result for UI display
 *
 * A view model that extracts execution state fields for component consumption.
 * Derived from RowExecutionResult but focused on display concerns.
 */
export interface ChainExecutionResult {
    status: "idle" | "pending" | "running" | "success" | "error" | "cancelled"
    output?: unknown
    error?: {message: string; code?: string}
    /** Trace ID for fetching structured span data */
    traceId?: string | null
    /** Chain execution progress (while running) */
    chainProgress?: ChainExecutionProgress | null
    /** Results from all nodes keyed by nodeId */
    chainResults?: Record<string, StageExecutionResult>
    /** Whether this is a chain execution */
    isChain?: boolean
    /** Total number of stages */
    totalStages?: number
}

/**
 * Info about a chain node for display
 */
export interface ChainNodeInfo {
    id: string
    label: string
    type: "legacyAppRevision" | "evaluatorRevision" | string
}
