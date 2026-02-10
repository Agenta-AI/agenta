/**
 * Commit Modal State
 *
 * Jotai atoms for managing commit modal state.
 * Uses atomWithReset for clean reset on modal close.
 *
 * The commit modal is for committing draft changes to an entity
 * (creating a new revision with a commit message).
 */

import {atom} from "jotai"
import {atomWithReset, RESET} from "jotai/utils"

import {getEntityAdapter} from "../adapters"
import type {CommitContext, EntityReference} from "../types"

// ============================================================================
// CORE STATE ATOMS
// ============================================================================

/**
 * Whether the commit modal is open
 */
export const commitModalOpenAtom = atomWithReset(false)

/**
 * Entity to be committed
 */
export const commitModalEntityAtom = atomWithReset<EntityReference | null>(null)

/**
 * Commit message
 */
export const commitModalMessageAtom = atomWithReset("")

/**
 * Loading state during commit operation
 */
export const commitModalLoadingAtom = atomWithReset(false)

/**
 * Error from commit operation
 */
export const commitModalErrorAtom = atomWithReset<Error | null>(null)

// ============================================================================
// DERIVED ATOMS
// ============================================================================

/**
 * Resolved entity name via adapter
 */
export const commitModalEntityNameAtom = atom((get): string => {
    const entity = get(commitModalEntityAtom)
    if (!entity) return ""

    // If name is already provided, use it
    if (entity.name) return entity.name

    // Try to resolve via adapter
    const adapter = getEntityAdapter(entity.type)
    if (!adapter) return entity.id

    const entityData = get(adapter.dataAtom(entity.id))
    return adapter.getDisplayName(entityData)
})

/**
 * Whether entity can be committed (based on adapter.canCommit)
 */
export const commitModalCanCommitAtom = atom((get): boolean => {
    const entity = get(commitModalEntityAtom)
    if (!entity) return false

    const adapter = getEntityAdapter(entity.type)
    if (!adapter?.canCommit) return true // Default to true if no canCommit defined

    const entityData = get(adapter.dataAtom(entity.id))
    return adapter.canCommit(entityData)
})

/**
 * Whether commit can proceed (has entity, message, and can commit)
 */
export const commitModalCanProceedAtom = atom((get): boolean => {
    const entity = get(commitModalEntityAtom)
    const message = get(commitModalMessageAtom)
    const canCommit = get(commitModalCanCommitAtom)
    const isLoading = get(commitModalLoadingAtom)

    return entity !== null && message.trim().length > 0 && canCommit && !isLoading
})

/**
 * Commit context from adapter (version info, changes summary, diff data)
 * Returns null if adapter doesn't provide commit context
 *
 * Passes entity.metadata to the adapter for context-specific information
 * (e.g., loadableId for playground-derived column changes)
 */
export const commitModalContextAtom = atom((get): CommitContext | null => {
    const entity = get(commitModalEntityAtom)
    if (!entity) return null

    const adapter = getEntityAdapter(entity.type)
    if (!adapter?.commitContextAtom) return null

    return get(adapter.commitContextAtom(entity.id, entity.metadata))
})

// ============================================================================
// ACTION ATOMS
// ============================================================================

/**
 * Reset all commit modal state
 */
export const resetCommitModalAtom = atom(null, (_get, set) => {
    set(commitModalOpenAtom, RESET)
    set(commitModalEntityAtom, RESET)
    set(commitModalMessageAtom, RESET)
    set(commitModalLoadingAtom, RESET)
    set(commitModalErrorAtom, RESET)
})

/**
 * Open commit modal for an entity
 */
export const openCommitModalAtom = atom(
    null,
    (_get, set, entity: EntityReference, initialMessage?: string) => {
        // Reset first to clear any previous state
        set(resetCommitModalAtom)
        // Set entity
        set(commitModalEntityAtom, entity)
        // Set initial message if provided
        if (initialMessage) {
            set(commitModalMessageAtom, initialMessage)
        }
        // Open modal
        set(commitModalOpenAtom, true)
    },
)

/**
 * Close commit modal without committing
 */
export const closeCommitModalAtom = atom(null, (_get, set) => {
    set(commitModalOpenAtom, false)
    // Note: Don't reset immediately - let afterClose handle it
})

/**
 * Update commit message
 */
export const setCommitMessageAtom = atom(null, (_get, set, message: string) => {
    set(commitModalMessageAtom, message)
})

/**
 * Execute commit operation via adapter
 *
 * Returns the result from the adapter's commitAtom (e.g., new revision ID)
 */
export const executeCommitAtom = atom(null, async (get, set) => {
    const entity = get(commitModalEntityAtom)
    const message = get(commitModalMessageAtom)
    const canProceed = get(commitModalCanProceedAtom)

    if (!entity || !canProceed) {
        set(commitModalErrorAtom, new Error("Cannot commit: missing entity or message"))
        return {success: false, error: "Missing entity or message"}
    }

    const adapter = getEntityAdapter(entity.type)
    if (!adapter?.commitAtom) {
        set(commitModalErrorAtom, new Error(`No commit adapter for type: ${entity.type}`))
        return {success: false, error: `No commit adapter for type: ${entity.type}`}
    }

    set(commitModalLoadingAtom, true)
    set(commitModalErrorAtom, null)

    try {
        // Execute commit via adapter
        await set(adapter.commitAtom, {id: entity.id, message: message.trim()})

        // Close modal on success
        set(commitModalOpenAtom, false)
        set(resetCommitModalAtom)

        return {success: true}
    } catch (error) {
        set(commitModalErrorAtom, error as Error)
        set(commitModalLoadingAtom, false)
        return {success: false, error: (error as Error).message}
    }
})

// ============================================================================
// CONVENIENCE ATOMS
// ============================================================================

/**
 * Combined commit modal state for components
 */
export const commitModalStateAtom = atom((get) => ({
    isOpen: get(commitModalOpenAtom),
    entity: get(commitModalEntityAtom),
    entityName: get(commitModalEntityNameAtom),
    message: get(commitModalMessageAtom),
    canCommit: get(commitModalCanCommitAtom),
    canProceed: get(commitModalCanProceedAtom),
    isLoading: get(commitModalLoadingAtom),
    error: get(commitModalErrorAtom),
}))
