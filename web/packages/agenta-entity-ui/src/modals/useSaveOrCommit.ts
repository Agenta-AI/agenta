/**
 * useSaveOrCommit Hook
 *
 * Unified hook that intelligently routes between commit and save modals
 * based on entity state:
 * - Dirty entities (with draft changes) → Commit modal
 * - New/unnamed entities → Save modal
 * - Save-as scenarios → Save modal with saveAsNew=true
 *
 * This provides a single entry point for saving entity changes,
 * abstracting the underlying modal choice.
 */

import {useCallback, useMemo} from "react"

import {useAtomValue, useSetAtom, Atom} from "jotai"

import {openCommitModalAtom, commitModalOpenAtom, commitModalLoadingAtom} from "./commit/state"
import {
    openSaveModalAtom,
    openSaveNewModalAtom,
    saveModalOpenAtom,
    saveModalLoadingAtom,
} from "./save/state"
import type {EntityType, EntityReference} from "./types"

// ============================================================================
// TYPES
// ============================================================================

/**
 * Entity state for routing decisions
 */
export interface EntityState {
    /** Whether entity has unsaved draft changes */
    isDirty: boolean
    /** Whether entity is new (not yet saved) */
    isNew: boolean
    /** Whether entity has a name */
    hasName: boolean
    /** Optional: suggested commit message based on changes */
    suggestedMessage?: string
}

/**
 * Options for save/commit operation
 */
export interface SaveOrCommitOptions {
    /** Force commit modal even for new entities */
    forceCommit?: boolean
    /** Force save modal even for dirty entities */
    forceSave?: boolean
    /** Save as a new copy */
    saveAsNew?: boolean
    /** Initial commit message */
    initialMessage?: string
    /** Initial entity name (for new entities) */
    initialName?: string
}

/**
 * Return type for useSaveOrCommit hook
 */
export interface UseSaveOrCommitReturn {
    /**
     * Save or commit an entity based on its state
     *
     * @param entity Entity reference
     * @param entityState State information for routing
     * @param options Additional options
     *
     * @example
     * ```tsx
     * const {saveOrCommit} = useSaveOrCommit()
     *
     * // Entity controller provides state
     * const [state, dispatch] = useAtom(testcase.controller(id))
     *
     * const handleSave = () => {
     *   saveOrCommit(
     *     {type: 'revision', id: revision.id, name: revision.name},
     *     {isDirty: state.isDirty, isNew: false, hasName: true}
     *   )
     * }
     * ```
     */
    saveOrCommit: (
        entity: EntityReference,
        entityState: EntityState,
        options?: SaveOrCommitOptions,
    ) => void

    /**
     * Create a new entity (opens save modal)
     *
     * @param type Entity type
     * @param initialName Optional initial name
     */
    createNew: (type: EntityType, initialName?: string) => void

    /**
     * Whether a save/commit operation is in progress
     */
    isSaving: boolean

    /**
     * Whether any modal is open
     */
    isOpen: boolean

    /**
     * Which modal is currently open
     */
    activeModal: "commit" | "save" | null
}

// ============================================================================
// HOOK
// ============================================================================

/**
 * Unified hook for save/commit operations
 *
 * Intelligently routes between commit and save modals based on entity state.
 *
 * @example
 * ```tsx
 * function EntityActions({entity, isDirty}: {entity: Entity; isDirty: boolean}) {
 *   const {saveOrCommit, isSaving} = useSaveOrCommit()
 *
 *   return (
 *     <Button
 *       onClick={() => saveOrCommit(
 *         {type: 'revision', id: entity.id, name: entity.name},
 *         {isDirty, isNew: false, hasName: true}
 *       )}
 *       loading={isSaving}
 *     >
 *       {isDirty ? 'Commit Changes' : 'Save'}
 *     </Button>
 *   )
 * }
 * ```
 */
export function useSaveOrCommit(): UseSaveOrCommitReturn {
    const openCommitModal = useSetAtom(openCommitModalAtom)
    const openSaveModal = useSetAtom(openSaveModalAtom)
    const openNewModal = useSetAtom(openSaveNewModalAtom)

    const commitOpen = useAtomValue(commitModalOpenAtom)
    const saveOpen = useAtomValue(saveModalOpenAtom)
    const commitLoading = useAtomValue(commitModalLoadingAtom)
    const saveLoading = useAtomValue(saveModalLoadingAtom)

    const saveOrCommit = useCallback(
        (entity: EntityReference, entityState: EntityState, options?: SaveOrCommitOptions) => {
            const {forceCommit, forceSave, saveAsNew, initialMessage, initialName} = options ?? {}

            // Determine which modal to use
            let useCommitModal = false

            if (forceCommit) {
                // Explicitly requested commit modal
                useCommitModal = true
            } else if (forceSave || saveAsNew) {
                // Explicitly requested save modal
                useCommitModal = false
            } else if (entityState.isNew) {
                // New entities need save modal (to get a name)
                useCommitModal = false
            } else if (!entityState.hasName) {
                // Entities without names need save modal
                useCommitModal = false
            } else if (entityState.isDirty) {
                // Dirty entities with names go to commit modal
                useCommitModal = true
            }
            // Default: save modal for non-dirty, named entities

            if (useCommitModal) {
                openCommitModal(entity, initialMessage || entityState.suggestedMessage)
            } else {
                if (entityState.isNew && !entity.id) {
                    // New entity without ID - use createNew flow
                    openNewModal(entity.type, initialName || entity.name)
                } else {
                    openSaveModal(entity, saveAsNew)
                }
            }
        },
        [openCommitModal, openSaveModal, openNewModal],
    )

    const createNew = useCallback(
        (type: EntityType, initialName?: string) => {
            openNewModal(type, initialName)
        },
        [openNewModal],
    )

    const isSaving = commitLoading || saveLoading
    const isOpen = commitOpen || saveOpen
    const activeModal = commitOpen ? "commit" : saveOpen ? "save" : null

    return {
        saveOrCommit,
        createNew,
        isSaving,
        isOpen,
        activeModal,
    }
}

// ============================================================================
// CONVENIENCE FACTORY
// ============================================================================

/**
 * Create a saveOrCommit hook bound to a specific entity state atom
 *
 * This is useful when you have a controller that provides isDirty state.
 *
 * @param isDirtyAtom Atom that returns whether entity is dirty
 *
 * @example
 * ```tsx
 * // In entity state file
 * export const useBoundSaveOrCommit = createBoundSaveOrCommit(
 *   (id: string) => testcase.selectors.isDirty(id)
 * )
 *
 * // In component
 * function TestcaseActions({id}: {id: string}) {
 *   const {saveOrCommit, isSaving} = useBoundSaveOrCommit(id)
 *   // ...
 * }
 * ```
 */
export function createBoundSaveOrCommit<TId = string>(
    createIsDirtyAtom: (id: TId) => Atom<boolean>,
    entityType: EntityType,
) {
    return function useBoundSaveOrCommit(id: TId, entityName?: string) {
        const {saveOrCommit, createNew, isSaving, isOpen, activeModal} = useSaveOrCommit()

        // Get isDirty from the provided atom factory
        const isDirtyAtom = useMemo(() => createIsDirtyAtom(id), [id])
        const isDirty = useAtomValue(isDirtyAtom)

        const handleSaveOrCommit = useCallback(
            (options?: SaveOrCommitOptions) => {
                saveOrCommit(
                    {type: entityType, id: id as string, name: entityName},
                    {isDirty, isNew: false, hasName: !!entityName},
                    options,
                )
            },
            [saveOrCommit, id, entityName, isDirty],
        )

        return {
            saveOrCommit: handleSaveOrCommit,
            createNew,
            isDirty,
            isSaving,
            isOpen,
            activeModal,
        }
    }
}

// ============================================================================
// HELPER: BUTTON LABEL
// ============================================================================

/**
 * Get appropriate button label based on entity state
 */
export function getSaveOrCommitLabel(entityState: EntityState): string {
    if (entityState.isNew) {
        return "Save"
    }
    if (entityState.isDirty) {
        return "Commit Changes"
    }
    return "Save As"
}

/**
 * Get appropriate button icon name based on entity state
 * (for use with lucide-react or similar)
 */
export function getSaveOrCommitIconName(entityState: EntityState): "save" | "git-commit" | "copy" {
    if (entityState.isNew) {
        return "save"
    }
    if (entityState.isDirty) {
        return "git-commit"
    }
    return "copy"
}
