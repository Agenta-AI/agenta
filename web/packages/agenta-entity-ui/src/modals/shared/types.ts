/**
 * Shared Types for Entity Modals
 *
 * Common types used across commit, save, and delete modals.
 */

import type {EntityReference, EntityType} from "../types"

// ============================================================================
// ACTION HOOK TYPES
// ============================================================================

/**
 * Base return type for entity action hooks
 */
export interface UseEntityActionReturn {
    /** Trigger action by type, id, and optional name */
    actionEntity: (type: EntityType, id: string, name?: string, ...args: unknown[]) => void
    /** Trigger action by entity reference */
    actionEntityRef: (entity: EntityReference, ...args: unknown[]) => void
    /** Whether the action is in progress */
    isActioning: boolean
    /** Whether the modal is open */
    isOpen: boolean
}
