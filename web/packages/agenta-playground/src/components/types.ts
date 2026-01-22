/**
 * Shared types for playground components
 */

import type {ChainExecutionProgress, StageExecutionResult} from "@agenta/entities/runnable"

/**
 * Chain execution result with progress and stage results
 * Used by PlaygroundContent and TestcasePanel
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
    type: "appRevision" | "evaluatorRevision" | string
}
