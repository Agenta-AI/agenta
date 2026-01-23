/**
 * Shared Types for Entity Modals
 *
 * Common types used across commit, save, and delete modals.
 */

import type {WritableAtom, Atom} from "jotai"

import type {EntityReference, EntityType} from "../types"

// ============================================================================
// BASE MODAL STATE
// ============================================================================

/**
 * Base modal state shape (common to all modals)
 */
export interface BaseModalState {
    /** Whether the modal is open */
    isOpen: boolean
    /** Loading state during operation */
    isLoading: boolean
    /** Error from operation */
    error: Error | null
}

// ============================================================================
// ACTION HOOK TYPES
// ============================================================================

/**
 * Configuration for creating an entity action hook
 */
export interface EntityActionHookConfig {
    /** Atom to open the modal */
    openAtom: WritableAtom<null, [entity: EntityReference, ...args: unknown[]], void>
    /** Atom to check loading state */
    loadingAtom: Atom<boolean>
    /** Atom to check if modal is open */
    openStateAtom: Atom<boolean>
}

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

// ============================================================================
// ADAPTER RESOLUTION TYPES
// ============================================================================

/**
 * Result from resolving entity name via adapter
 */
export interface ResolvedEntityName {
    /** Resolved name */
    name: string
    /** Whether name was resolved from adapter or fallback */
    fromAdapter: boolean
}
