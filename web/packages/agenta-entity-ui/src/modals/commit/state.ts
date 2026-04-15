/**
 * Commit Modal State
 *
 * Jotai atoms for managing commit modal state.
 * Uses atomWithReset for clean reset on modal close.
 *
 * The commit modal is for committing draft changes to an entity
 * (creating a new revision with a commit message).
 */

import {extractApiErrorMessage} from "@agenta/shared/utils"
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
 * Action label for the modal (e.g., "Commit" or "Create").
 * Controls the title, subtitle, and button text throughout the modal.
 * Defaults to "Commit" when not explicitly set.
 */
export const commitModalActionLabelAtom = atomWithReset("Commit")

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

/**
 * User-edited entity name override.
 * When set (non-null), this takes precedence over the resolved entity name.
 * Used in "Create" flows where the user can rename the entity before creating.
 */
export const commitModalEntityNameOverrideAtom = atomWithReset<string | null>(null)

// ============================================================================
// DERIVED ATOMS
// ============================================================================

/**
 * Resolved entity name via adapter.
 * If the user has edited the name (via commitModalEntityNameOverrideAtom), that takes precedence.
 */
export const commitModalEntityNameAtom = atom((get): string => {
    // Check for user-edited name override first
    const nameOverride = get(commitModalEntityNameOverrideAtom)
    if (nameOverride !== null) return nameOverride

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
    // Default to true while adapter data is still loading — the actual
    // submit guard (canProceed) prevents premature commits.
    if (entityData === null || entityData === undefined) return true
    return adapter.canCommit(entityData)
})

/**
 * Whether commit can proceed (has entity, message, and can commit)
 */
export const commitModalCanProceedAtom = atom((get): boolean => {
    const entity = get(commitModalEntityAtom)
    const canCommit = get(commitModalCanCommitAtom)
    const isLoading = get(commitModalLoadingAtom)

    return entity !== null && canCommit && !isLoading
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
    set(commitModalActionLabelAtom, RESET)
    set(commitModalEntityNameOverrideAtom, RESET)
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
 * Set loading state explicitly (for custom submit flows).
 */
export const setCommitLoadingAtom = atom(null, (_get, set, isLoading: boolean) => {
    set(commitModalLoadingAtom, isLoading)
})

/**
 * Set error state explicitly (for custom submit flows).
 */
export const setCommitErrorAtom = atom(null, (_get, set, error: Error | null) => {
    set(commitModalErrorAtom, error)
})

/**
 * Update entity name override (for editable name in Create flows).
 */
export const setCommitEntityNameAtom = atom(null, (_get, set, name: string | null) => {
    set(commitModalEntityNameOverrideAtom, name)
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
        const message = extractApiErrorMessage(error)
        set(
            commitModalErrorAtom,
            error instanceof Error ? Object.assign(error, {message}) : new Error(message),
        )
        set(commitModalLoadingAtom, false)
        return {success: false, error: message}
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
