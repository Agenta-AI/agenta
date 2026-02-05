/**
 * Entity Modal Action Reducer
 *
 * Reducer-style dispatcher that routes entity modal actions to the
 * appropriate modal hooks. Delegates to existing hooks rather than
 * re-implementing their logic.
 */

import type {EntityReference, EntityType} from "../types"
import type {EntityState, SaveOrCommitOptions} from "../useSaveOrCommit"

import type {EntityModalAction} from "./types"

// ============================================================================
// HELPER TYPES
// ============================================================================

/**
 * Helper functions provided to the reducer for dispatching to modals
 */
export interface EntityActionHelpers {
    /** Open commit modal */
    commit: (entity: EntityReference, initialMessage?: string) => void
    /** Open save modal for existing entity */
    save: (entity: EntityReference, saveAsNew?: boolean) => void
    /** Open save modal for new entity */
    create: (type: EntityType, initialName?: string) => void
    /** Open delete modal */
    remove: (entities: EntityReference[], onSuccess?: () => void) => void
    /** Intelligently route between save and commit */
    saveOrCommit: (
        entity: EntityReference,
        state: EntityState,
        options?: SaveOrCommitOptions,
    ) => void
}

// ============================================================================
// REDUCER
// ============================================================================

/**
 * Dispatch an entity modal action to the appropriate modal
 *
 * This reducer delegates to the existing modal hooks rather than
 * re-implementing their logic. It provides a single entry point
 * for all entity modal operations.
 *
 * @param action The action to dispatch
 * @param helpers Helper functions for opening modals
 *
 * @example
 * ```typescript
 * // Inside EntityActionProvider
 * const helpers: EntityActionHelpers = {
 *   commit: (entity, msg) => openCommitModal(entity, msg),
 *   save: (entity, saveAsNew) => openSaveModal(entity, saveAsNew),
 *   create: (type, name) => openNewModal(type, name),
 *   remove: (entities, onSuccess) => openDeleteModal({entities, onSuccess}),
 *   saveOrCommit: (entity, state, opts) => saveOrCommitFn(entity, state, opts),
 * }
 *
 * reduceEntityModalAction({type: 'commit', entity, initialMessage}, helpers)
 * ```
 */
export function reduceEntityModalAction(
    action: EntityModalAction,
    helpers: EntityActionHelpers,
): void {
    switch (action.type) {
        case "commit":
            helpers.commit(action.entity, action.initialMessage)
            return

        case "save":
            helpers.save(action.entity, action.saveAsNew)
            return

        case "create":
            helpers.create(action.entityType, action.initialName)
            return

        case "delete":
            helpers.remove(action.entities, action.onSuccess)
            return

        case "saveOrCommit":
            helpers.saveOrCommit(action.entity, action.state, action.options)
            return

        default: {
            // Exhaustive check - TypeScript will error if a case is missing
            const _exhaustive: never = action
            console.warn("[EntityActions] Unknown action type:", _exhaustive)
        }
    }
}
