/**
 * Entity Modal Action Types
 *
 * Type definitions for the unified entity action dispatch system.
 * These types define the actions that can be dispatched to open
 * entity modals (commit, save, delete).
 *
 * NOTE: Named `EntityModalAction` to avoid collision with `EntityAction`
 * from @agenta/entities which is used for controller dispatch.
 */

import type {EntityType, EntityReference} from "../types"
import type {EntityState, SaveOrCommitOptions} from "../useSaveOrCommit"

// ============================================================================
// ACTION TYPES
// ============================================================================

/**
 * Action to open the commit modal for an entity
 */
export interface CommitAction {
    type: "commit"
    /** Entity to commit */
    entity: EntityReference
    /** Optional initial commit message */
    initialMessage?: string
}

/**
 * Action to open the save modal for an existing entity
 */
export interface SaveAction {
    type: "save"
    /** Entity to save */
    entity: EntityReference
    /** Whether to save as a new copy */
    saveAsNew?: boolean
}

/**
 * Action to open the save modal for creating a new entity
 */
export interface CreateAction {
    type: "create"
    /** Entity type to create */
    entityType: EntityType
    /** Optional initial name */
    initialName?: string
}

/**
 * Action to open the delete modal for one or more entities
 */
export interface DeleteAction {
    type: "delete"
    /** Entities to delete */
    entities: EntityReference[]
    /** Callback after successful deletion */
    onSuccess?: () => void
}

/**
 * Action that intelligently routes between save and commit modals
 * based on entity state (uses useSaveOrCommit logic)
 */
export interface SaveOrCommitAction {
    type: "saveOrCommit"
    /** Entity to save or commit */
    entity: EntityReference
    /** Entity state for routing decision */
    state: EntityState
    /** Additional options */
    options?: SaveOrCommitOptions
}

/**
 * Union type of all entity modal actions
 */
export type EntityModalAction =
    | CommitAction
    | SaveAction
    | CreateAction
    | DeleteAction
    | SaveOrCommitAction

// ============================================================================
// ACTION CREATORS
// ============================================================================

/**
 * Create a commit action
 */
export function commitAction(entity: EntityReference, initialMessage?: string): CommitAction {
    return {type: "commit", entity, initialMessage}
}

/**
 * Create a save action
 */
export function saveAction(entity: EntityReference, saveAsNew?: boolean): SaveAction {
    return {type: "save", entity, saveAsNew}
}

/**
 * Create a create action
 */
export function createAction(entityType: EntityType, initialName?: string): CreateAction {
    return {type: "create", entityType, initialName}
}

/**
 * Create a delete action
 */
export function deleteAction(entities: EntityReference[], onSuccess?: () => void): DeleteAction {
    return {type: "delete", entities, onSuccess}
}

/**
 * Create a saveOrCommit action
 */
export function saveOrCommitAction(
    entity: EntityReference,
    state: EntityState,
    options?: SaveOrCommitOptions,
): SaveOrCommitAction {
    return {type: "saveOrCommit", entity, state, options}
}

// ============================================================================
// DISPATCH STATE TYPES
// ============================================================================

/**
 * Which modal is currently active
 */
export type ActiveModal = "commit" | "save" | "delete" | null

/**
 * State of the entity action dispatch system
 */
export interface EntityActionState {
    /** Which modal is currently open */
    activeModal: ActiveModal
    /** Whether any modal is open */
    isOpen: boolean
    /** Whether any operation is in progress */
    isLoading: boolean
}
