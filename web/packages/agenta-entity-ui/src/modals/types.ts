/**
 * Entity Modals Core Types
 *
 * Types for entity modals that work with the molecule pattern.
 * Includes EntityReference, EntityGroup, and adapter interfaces.
 */

import type {ReactNode} from "react"

import type {Atom, WritableAtom} from "jotai"

// ============================================================================
// ENTITY TYPES
// ============================================================================

/**
 * Supported entity types for modal operations
 */
export type EntityType = "testset" | "revision" | "variant" | "evaluator" | "application"

/**
 * Reference to an entity for modal operations
 */
export interface EntityReference {
    /** Entity ID */
    id: string
    /** Entity type */
    type: EntityType
    /** Display name (optional, can be resolved via adapter) */
    name?: string
    /** Additional metadata for special handling */
    metadata?: Record<string, unknown>
}

/**
 * Group of entities by type for display
 */
export interface EntityGroup {
    /** Entity type for this group */
    type: EntityType
    /** Entities in this group */
    entities: EntityReference[]
    /** Display label (e.g., "Testsets", "Revisions") */
    displayLabel: string
}

// ============================================================================
// ADAPTER INTERFACES
// ============================================================================

/**
 * Parameters for commit operations
 */
export interface CommitParams {
    /** Entity ID to commit */
    id: string
    /** Commit message */
    message: string
}

/**
 * Changes summary for commit modal display
 */
export interface CommitChangesSummary {
    /** Number of modified items */
    modifiedCount?: number
    /** Number of added items */
    addedCount?: number
    /** Number of deleted items */
    deletedCount?: number
    /** Number of added columns */
    addedColumns?: number
    /** Number of renamed columns */
    renamedColumns?: number
    /** Number of deleted columns */
    deletedColumns?: number
    /** Custom description text */
    description?: string
}

/**
 * Version info for commit modal display
 */
export interface CommitVersionInfo {
    /** Current version number */
    currentVersion: number
    /** Target version number (usually current + 1) */
    targetVersion: number
    /** Latest version in the revision history */
    latestVersion?: number
}

/**
 * Diff data for commit modal preview
 */
export interface CommitDiffData {
    /** Original data (JSON string) */
    original: string
    /** Modified data (JSON string) */
    modified: string
    /** Language for syntax highlighting */
    language?: string
}

/**
 * Commit context provided by adapter for modal display
 */
export interface CommitContext {
    /** Version transition info */
    versionInfo?: CommitVersionInfo
    /** Changes summary */
    changesSummary?: CommitChangesSummary
    /** Diff data for preview */
    diffData?: CommitDiffData
}

/**
 * Parameters for save operations
 */
export interface SaveParams {
    /** Entity ID to save (or undefined for new entity) */
    id?: string
    /** Entity name */
    name: string
    /** Whether to create a new entity (save-as) */
    saveAsNew?: boolean
}

/**
 * Adapter interface for entity-specific modal behaviors
 *
 * Each entity type (testset, variant, etc.) provides an adapter
 * that defines how it should be displayed and operated on in modals.
 */
export interface EntityModalAdapter<TEntity = unknown> {
    /** Entity type this adapter handles */
    type: EntityType

    // ========== DISPLAY ==========

    /**
     * Get display name for an entity
     */
    getDisplayName: (entity: TEntity | null) => string

    /**
     * Get display label for entity count (e.g., "testset" vs "testsets")
     */
    getDisplayLabel: (count: number) => string

    /**
     * Optional icon for entity type
     */
    getIcon?: () => ReactNode

    // ========== VALIDATION ==========

    /**
     * Check if entity can be deleted
     */
    canDelete?: (entity: TEntity | null) => boolean

    /**
     * Get warning message for delete operation
     */
    getDeleteWarning?: (entity: TEntity | null) => string | null

    /**
     * Check if entity can be committed
     */
    canCommit?: (entity: TEntity | null) => boolean

    // ========== OPERATIONS (via molecule reducers) ==========

    /**
     * Delete atom - accepts array of IDs
     */
    deleteAtom: WritableAtom<unknown, [ids: string[]], Promise<void>>

    /**
     * Optional commit atom
     */
    commitAtom?: WritableAtom<unknown, [params: CommitParams], Promise<void>>

    /**
     * Optional save atom
     */
    saveAtom?: WritableAtom<unknown, [params: SaveParams], Promise<string>>

    // ========== DATA ACCESS ==========

    /**
     * Get data atom for an entity ID
     */
    dataAtom: (id: string) => Atom<TEntity | null>

    // ========== COMMIT CONTEXT (optional) ==========

    /**
     * Get commit context atom for an entity ID
     * Returns version info, changes summary, and diff data for commit modal display
     *
     * @param id - Entity ID
     * @param metadata - Optional metadata from EntityReference (e.g., loadableId for playground context)
     */
    commitContextAtom?: (
        id: string,
        metadata?: Record<string, unknown>,
    ) => Atom<CommitContext | null>
}

// ============================================================================
// DELETE MODAL TYPES
// ============================================================================

/**
 * Delete modal state
 */
export interface DeleteModalState {
    /** Whether modal is open */
    isOpen: boolean
    /** Entities to delete */
    entities: EntityReference[]
    /** Loading state */
    isLoading: boolean
    /** Error if any */
    error: Error | null
}

/**
 * Props for EntityDeleteModal component
 */
export interface EntityDeleteModalProps {
    /** External control - override atom state */
    open?: boolean
    /** Callback when modal closes */
    onClose?: () => void
    /** Entities to delete (alternative to using atoms) */
    entities?: EntityReference[]
    /** Callback after successful delete */
    onSuccess?: () => void
}

// ============================================================================
// COMMIT MODAL TYPES
// ============================================================================

/**
 * Commit modal state
 */
export interface CommitModalState {
    /** Whether modal is open */
    isOpen: boolean
    /** Entity to commit */
    entity: EntityReference | null
    /** Commit message */
    message: string
    /** Loading state */
    isLoading: boolean
    /** Error if any */
    error: Error | null
}

/**
 * Props for EntityCommitModal component
 */
export interface EntityCommitModalProps {
    /** External control - override atom state */
    open?: boolean
    /** Callback when modal closes */
    onClose?: () => void
    /** Entity to commit */
    entity?: EntityReference
    /** Callback after successful commit */
    onSuccess?: (result: {newRevisionId?: string}) => void
}

// ============================================================================
// SAVE MODAL TYPES
// ============================================================================

/**
 * Save modal state
 */
export interface SaveModalState {
    /** Whether modal is open */
    isOpen: boolean
    /** Entity to save (null for new entity) */
    entity: EntityReference | null
    /** Entity name */
    name: string
    /** Whether saving as new */
    saveAsNew: boolean
    /** Loading state */
    isLoading: boolean
    /** Error if any */
    error: Error | null
}

/**
 * Props for EntitySaveModal component
 */
export interface EntitySaveModalProps {
    /** External control - override atom state */
    open?: boolean
    /** Callback when modal closes */
    onClose?: () => void
    /** Entity to save */
    entity?: EntityReference
    /** Default entity type for new entities */
    defaultEntityType?: EntityType
    /** Callback after successful save */
    onSuccess?: (result: {id: string; name: string}) => void
}

// ============================================================================
// HELPER TYPES
// ============================================================================

/**
 * Helper to group entities by type
 */
export function groupEntitiesByType(entities: EntityReference[]): EntityGroup[] {
    const groups = new Map<EntityType, EntityReference[]>()

    for (const entity of entities) {
        const existing = groups.get(entity.type) ?? []
        groups.set(entity.type, [...existing, entity])
    }

    return Array.from(groups.entries()).map(([type, groupEntities]) => ({
        type,
        entities: groupEntities,
        displayLabel: getEntityTypeLabel(type, groupEntities.length),
    }))
}

/**
 * Label casing options
 */
export type LabelCase = "capitalize" | "lowercase"

/**
 * Get display label for entity type
 *
 * @param type - Entity type
 * @param count - Number of entities (1 = singular, >1 = plural)
 * @param casing - Label casing: 'capitalize' (default) or 'lowercase'
 *
 * @example
 * ```typescript
 * getEntityTypeLabel("testset", 1) // "Testset"
 * getEntityTypeLabel("testset", 2) // "Testsets"
 * getEntityTypeLabel("testset", 1, "lowercase") // "testset"
 * getEntityTypeLabel("testset", 2, "lowercase") // "testsets"
 * ```
 */
export function getEntityTypeLabel(
    type: EntityType,
    count: number,
    casing: LabelCase = "capitalize",
): string {
    const labels: Record<EntityType, [string, string]> = {
        testset: ["Testset", "Testsets"],
        revision: ["Revision", "Revisions"],
        variant: ["Variant", "Variants"],
        evaluator: ["Evaluator", "Evaluators"],
        application: ["Application", "Applications"],
    }

    const [singular, plural] = labels[type]
    const label = count === 1 ? singular : plural
    return casing === "lowercase" ? label.toLowerCase() : label
}
