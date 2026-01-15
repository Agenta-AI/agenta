/**
 * Entity Selection Adapter Types
 *
 * Types for creating and registering entity selection adapters.
 */

import type {ReactNode} from "react"

import type {Atom} from "jotai"

import type {
    SelectableEntityType,
    EntitySelectionResult,
    SelectionPathItem,
    HierarchyLevel,
    EntitySelectionAdapter,
    ListQueryState,
    PaginatedListQueryState,
    PaginationParams,
} from "../types"

// ============================================================================
// ADAPTER CREATION OPTIONS
// ============================================================================

/**
 * Options for creating a level in the hierarchy
 */
export interface CreateHierarchyLevelOptions<T = unknown> {
    /** Entity type at this level */
    type: SelectableEntityType

    /**
     * Static atom for root-level lists
     */
    listAtom?: Atom<ListQueryState<T>>

    /**
     * Atom family for child lists
     */
    listAtomFamily?: (parentId: string) => Atom<ListQueryState<T>>

    // ========================================================================
    // PAGINATION SUPPORT
    // ========================================================================

    /**
     * Paginated atom factory for root-level lists
     * Returns an atom for the given pagination params
     */
    paginatedListAtom?: (params: PaginationParams) => Atom<PaginatedListQueryState<T>>

    /**
     * Paginated atom family for child lists
     * Returns an atom for the given parent ID and pagination params
     */
    paginatedListAtomFamily?: (
        parentId: string,
        params: PaginationParams,
    ) => Atom<PaginatedListQueryState<T>>

    /**
     * Whether server-side search is supported for this level
     * When true, search term is sent to server instead of client-side filtering
     * @default false
     */
    supportsServerSearch?: boolean

    /**
     * Field to use for search filtering
     * Used for client-side filtering when supportsServerSearch is false
     */
    searchField?: string

    // ========================================================================
    // ENTITY ACCESSORS
    // ========================================================================

    /**
     * Get ID from entity
     */
    getId: (entity: T) => string

    /**
     * Get display label (text version, used for search/filter/accessibility)
     */
    getLabel: (entity: T) => string

    /**
     * Get rich label node (optional, for enhanced display with badges/icons)
     * Falls back to getLabel if not provided
     */
    getLabelNode?: (entity: T) => ReactNode

    /**
     * Get optional icon
     */
    getIcon?: (entity: T) => ReactNode

    /**
     * Can this entity be expanded?
     */
    hasChildren?: (entity: T) => boolean

    /**
     * Is this entity selectable as final selection?
     */
    isSelectable?: (entity: T) => boolean

    /**
     * Is this entity disabled?
     */
    isDisabled?: (entity: T) => boolean

    /**
     * Get description text
     */
    getDescription?: (entity: T) => string | undefined

    /**
     * Callback to enable/prepare the query before loading children.
     * Called with the parent ID when navigating into this level.
     * Use this for lazy-enabled queries that require explicit activation.
     */
    onBeforeLoad?: (parentId: string) => void
}

/**
 * Options for creating an entity selection adapter
 */
export interface CreateSelectionAdapterOptions<TSelection = EntitySelectionResult> {
    /** Unique adapter name */
    name: string

    /** Primary entity type */
    entityType: SelectableEntityType

    /** Hierarchy levels */
    levels: CreateHierarchyLevelOptions<unknown>[]

    /** Which level is selectable (default: last) */
    selectableLevel?: number

    /**
     * Transform path + leaf entity to selection result
     */
    toSelection: (path: SelectionPathItem[], leafEntity: unknown) => TSelection

    /** Empty state message */
    emptyMessage?: string

    /** Loading message */
    loadingMessage?: string

    /** Icon for this entity type */
    icon?: ReactNode
}

// ============================================================================
// ADAPTER REGISTRY
// ============================================================================

/**
 * Adapter registration entry
 */
export interface AdapterRegistryEntry<TSelection = EntitySelectionResult> {
    adapter: EntitySelectionAdapter<TSelection>
    entityTypes: SelectableEntityType[]
}

/**
 * Type for the adapter registry
 */
export type AdapterRegistry = Map<string, AdapterRegistryEntry>

// ============================================================================
// RE-EXPORTS
// ============================================================================

export type {
    SelectableEntityType,
    EntitySelectionResult,
    SelectionPathItem,
    HierarchyLevel,
    EntitySelectionAdapter,
    ListQueryState,
    PaginatedListQueryState,
    PaginationParams,
}
