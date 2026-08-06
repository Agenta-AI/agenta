/**
 * SimpleQueue Entity Types
 *
 * TypeScript interfaces for API parameters and internal types.
 */

import type {WindowingState} from "../../shared/tableTypes"

import type {SimpleQueueKind} from "./schema"

// ============================================================================
// API PARAMETER TYPES
// ============================================================================

/**
 * Params for querying the simple queues list
 */
export interface SimpleQueueListParams {
    projectId: string
    kind?: SimpleQueueKind | null
    userId?: string | null
    name?: string | null
    windowing?: WindowingState | null
}

/**
 * Params for fetching a single simple queue
 */
export interface SimpleQueueDetailParams {
    id: string
    projectId: string
}

/**
 * Params for querying scenarios of a queue
 */
export interface SimpleQueueScenariosParams {
    queueId: string
    projectId: string
    userId?: string | null
    scenario?: {
        status?: string | null
        statuses?: string[] | null
    } | null
    windowing?: WindowingState | null
}
