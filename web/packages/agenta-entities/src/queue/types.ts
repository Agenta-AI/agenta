/**
 * Queue Controller Types
 *
 * Unified types for the queue controller that bridges
 * SimpleQueue and EvaluationQueue molecules.
 */

import type {Atom} from "jotai"

import type {SimpleQueueKind} from "../simpleQueue/core"

// ============================================================================
// QUEUE TYPE
// ============================================================================

/**
 * The two queue flavors supported by the controller.
 */
export type QueueType = "simple" | "evaluation"

// ============================================================================
// UNIFIED QUEUE DATA
// ============================================================================

/**
 * Normalized queue data returned by the controller.
 * Provides a consistent shape regardless of the underlying queue type.
 */
export interface QueueData {
    /** Queue entity ID */
    id: string
    /** Which queue type this came from */
    type: QueueType
    /** Queue name */
    name: string | null
    /** Queue description */
    description: string | null
    /** Queue status (evaluation status enum value) */
    status: string | null
    /** Parent evaluation run ID */
    runId: string
    /** Queue kind (simple queues only: "traces" | "testcases") */
    kind: SimpleQueueKind | null
    /** Created at timestamp */
    createdAt: string | null
    /** Created by user ID */
    createdById: string | null
}

// ============================================================================
// QUERY STATE
// ============================================================================

/**
 * Query state for a queue entity.
 */
export interface QueueQueryState {
    data: QueueData | null
    isPending: boolean
    isError: boolean
    error: Error | null
}

// ============================================================================
// INTERNAL MOLECULE CONFIG (type-erased for probing)
// ============================================================================

/**
 * Internal configuration for a queue type's molecule integration.
 * Uses `unknown` entity type to allow uniform probing across different molecules.
 */
export interface InternalQueueTypeConfig<TEntity = unknown> {
    molecule: {
        selectors: {
            data: (id: string) => Atom<TEntity | null>
            query: (id: string) => Atom<{
                data: TEntity | null
                isPending: boolean
                isError: boolean
                error?: Error | null
            }>
            isDirty: (id: string) => Atom<boolean>
            status: (id: string) => Atom<string | null>
        }
    }
    /** Map the raw entity to the unified QueueData shape */
    toQueueData: (entity: TEntity) => QueueData
}
