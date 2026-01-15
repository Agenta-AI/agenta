/**
 * Entity Selection Types
 *
 * Core types for the unified entity selection system.
 * Supports hierarchical navigation, multi-selection, and adapter-based configuration.
 */

import type {ReactNode} from "react"

import type {Atom} from "jotai"

// ============================================================================
// ENTITY TYPES
// ============================================================================

/**
 * Supported entity types for selection
 */
export type SelectableEntityType =
    | "testset"
    | "revision"
    | "app"
    | "variant"
    | "appRevision"
    | "evaluator"
    | "evaluatorVariant"
    | "evaluatorRevision"

// ============================================================================
// SELECTION RESULT
// ============================================================================

/**
 * A single item in the selection path (breadcrumb)
 */
export interface SelectionPathItem {
    /** Entity type at this level */
    type: SelectableEntityType
    /** Entity ID */
    id: string
    /** Display label */
    label: string
}

/**
 * Selection result returned when user selects an entity
 */
export interface EntitySelectionResult<TMeta = unknown> {
    /** Entity type of the selected item */
    type: SelectableEntityType
    /** Entity ID */
    id: string
    /** Display label */
    label: string
    /** Full path from root to this entity */
    path: SelectionPathItem[]
    /** Entity-specific metadata */
    metadata?: TMeta
}

// ============================================================================
// HIERARCHY CONFIGURATION
// ============================================================================

/**
 * Query state for list atoms
 */
export interface ListQueryState<T> {
    data: T[] | undefined
    isPending: boolean
    isError: boolean
    error?: Error | null
}

// ============================================================================
// PAGINATION TYPES
// ============================================================================

/**
 * Parameters for paginated list queries
 */
export interface PaginationParams {
    /** Number of items per page */
    pageSize: number
    /** Cursor for cursor-based pagination */
    cursor: string | null
    /** Offset for offset-based pagination */
    offset: number
    /** Search term for server-side filtering (optional) */
    searchTerm?: string
}

/**
 * Pagination metadata returned from paginated queries
 */
export interface PaginationInfo {
    /** Whether more pages exist */
    hasNextPage: boolean
    /** Cursor for the next page (cursor-based pagination) */
    nextCursor: string | null
    /** Offset for the next page (offset-based pagination) */
    nextOffset: number | null
    /** Total count of items (if known) */
    totalCount: number | null
    /** Whether currently fetching the next page */
    isFetchingNextPage: boolean
}

/**
 * Extended query state with pagination support
 */
export interface PaginatedListQueryState<T> extends ListQueryState<T> {
    /** Pagination metadata */
    pagination?: PaginationInfo
    /** Function to fetch the next page */
    fetchNextPage?: () => void
}

/**
 * Defines a level in the entity hierarchy
 */
export interface HierarchyLevel<T = unknown> {
    /** Entity type at this level */
    type: SelectableEntityType

    /**
     * Static atom for root-level lists (no parent dependency)
     * Use this for the first level of the hierarchy
     */
    listAtom?: Atom<ListQueryState<T>>

    /**
     * Atom family for child lists (depends on parent ID)
     * Use this for non-root levels
     */
    listAtomFamily?: (parentId: string) => Atom<ListQueryState<T>>

    // ========================================================================
    // PAGINATED VARIANTS (optional - for infinite scroll support)
    // ========================================================================

    /**
     * Paginated atom for root-level lists
     * Use this for large lists that benefit from pagination
     */
    paginatedListAtom?: (params: PaginationParams) => Atom<PaginatedListQueryState<T>>

    /**
     * Paginated atom family for child lists (depends on parent ID)
     */
    paginatedListAtomFamily?: (
        parentId: string,
        params: PaginationParams,
    ) => Atom<PaginatedListQueryState<T>>

    /**
     * Whether this level supports server-side search
     * When true, search term is sent to server instead of client-side filtering
     * @default false
     */
    supportsServerSearch?: boolean

    /**
     * Field name used for server-side search
     */
    searchField?: string

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
     * Can this entity be expanded (has children)?
     * @default true if not last level
     */
    hasChildren?: (entity: T) => boolean

    /**
     * Is this entity selectable as final selection?
     * @default true if last level
     */
    isSelectable?: (entity: T) => boolean

    /**
     * Callback to enable/prepare the query before loading children.
     * Called with the parent ID when navigating into this level.
     * Use this for lazy-enabled queries that require explicit activation.
     */
    onBeforeLoad?: (parentId: string) => void

    /**
     * Is this entity disabled (visible but not selectable)?
     */
    isDisabled?: (entity: T) => boolean

    /**
     * Get description text for entity
     */
    getDescription?: (entity: T) => string | undefined
}

/**
 * Complete hierarchy definition from root to leaf
 */
export interface HierarchyConfig {
    /** Hierarchy levels from root to leaf */
    levels: HierarchyLevel<unknown>[]
    /** Which level is the selection target (default: last level) */
    selectableLevel?: number
}

// ============================================================================
// ADAPTER INTERFACE
// ============================================================================

/**
 * Adapter interface for connecting entity molecules to selection UI
 *
 * Each entity type (testset, appRevision, etc.) provides an adapter
 * that defines its hierarchy and how selections are transformed.
 */
export interface EntitySelectionAdapter<TSelection = EntitySelectionResult> {
    /** Unique adapter identifier */
    name: string

    /** Primary entity type this adapter handles */
    entityType: SelectableEntityType

    /** Hierarchy configuration */
    hierarchy: HierarchyConfig

    /**
     * Transform raw selection to result format
     */
    toSelection: (path: SelectionPathItem[], leafEntity: unknown) => TSelection

    /**
     * Validate if selection is complete
     */
    isComplete: (path: SelectionPathItem[]) => boolean

    /** Optional: custom empty state message */
    emptyMessage?: string

    /** Optional: custom loading message */
    loadingMessage?: string

    /** Optional: icon for this entity type */
    icon?: ReactNode
}

// ============================================================================
// SELECTION STATE
// ============================================================================

/**
 * Current navigation state in the hierarchy
 */
export interface HierarchicalSelectionState {
    /** Current path in the hierarchy (breadcrumb) */
    currentPath: SelectionPathItem[]
    /** Current level index */
    currentLevel: number
    /** Search term for filtering */
    searchTerm: string
}

/**
 * Multi-selection state
 */
export interface MultiSelectionState<T = EntitySelectionResult> {
    /** Selected entities */
    selectedItems: T[]
    /** Selected IDs for quick lookup */
    selectedIds: Set<string>
    /** Is multi-selection mode active */
    isMultiSelectMode: boolean
    /** Maximum selections allowed (undefined = unlimited) */
    maxSelections?: number
}

// ============================================================================
// COMPONENT PROPS
// ============================================================================

/**
 * Base props for all selection components
 */
export interface EntitySelectionBaseProps<TSelection = EntitySelectionResult> {
    /** Adapter to use (or adapter name to resolve from registry) */
    adapter: EntitySelectionAdapter<TSelection> | string
    /** Allowed entity types (filters tabs/options) */
    allowedTypes?: SelectableEntityType[]
    /** Called when selection is complete */
    onSelect?: (selection: TSelection) => void
    /** Called when selection is cancelled */
    onCancel?: () => void
    /** Placeholder text */
    placeholder?: string
    /** Disabled state */
    disabled?: boolean
    /** Custom class name */
    className?: string
}

/**
 * Props for inline picker component
 */
export interface EntityPickerProps<
    TSelection = EntitySelectionResult,
> extends EntitySelectionBaseProps<TSelection> {
    /** Auto-select when only one option at a level */
    autoSelectSingle?: boolean
    /** Show search input */
    showSearch?: boolean
    /** Compact mode (smaller spacing) */
    compact?: boolean
}

/**
 * Props for cascader-style selectors
 */
export interface EntityCascaderProps<
    TSelection = EntitySelectionResult,
> extends EntitySelectionBaseProps<TSelection> {
    /** Current value (for controlled mode) */
    value?: TSelection | null
    /** Called when value changes */
    onChange?: (value: TSelection | null) => void
    /** Enable search */
    showSearch?: boolean
    /** Allow clearing selection */
    allowClear?: boolean
    /** Expand trigger */
    expandTrigger?: "click" | "hover"
    /** Custom display render for selected value */
    displayRender?: (path: SelectionPathItem[]) => ReactNode
    /** Size variant */
    size?: "small" | "middle" | "large"
}

/**
 * Props for menu-style selectors
 */
export interface EntityMenuProps<
    TSelection = EntitySelectionResult,
> extends EntitySelectionBaseProps<TSelection> {
    /** Show "Create New" option */
    showCreateNew?: boolean
    /** Called when "Create New" is clicked */
    onCreateNew?: () => void
    /** Selected item ID (for highlighting) */
    selectedId?: string
    /** Max height before scrolling */
    maxHeight?: number | string
}

/**
 * Props for modal-based selectors
 */
export interface EntitySelectorModalProps<
    TSelection = EntitySelectionResult,
> extends EntitySelectionBaseProps<TSelection> {
    /** Modal open state */
    open: boolean
    /** Modal title */
    title?: string
    /** Modal width */
    width?: number
    /** Destroy content on close */
    destroyOnClose?: boolean
}

/**
 * Props for multi-select scenarios
 */
export interface EntityMultiSelectProps<
    TSelection = EntitySelectionResult,
> extends EntitySelectionBaseProps<TSelection> {
    /** Current selections */
    value?: TSelection[]
    /** Max number of selections */
    maxSelections?: number
    /** Called when selections change */
    onChange?: (selections: TSelection[]) => void
}

// ============================================================================
// MODAL CONTROLLER TYPES
// ============================================================================

/**
 * Configuration for opening entity selector modal
 */
export interface EntitySelectorConfig {
    /** Allowed entity types */
    allowedTypes?: SelectableEntityType[]
    /** Modal title */
    title?: string
    /** Adapters to use (optional, defaults to registered adapters) */
    adapters?: EntitySelectionAdapter[]
}

/**
 * Resolve function type for modal promise
 */
export type EntitySelectorResolver<T = EntitySelectionResult> = (selection: T | null) => void

// ============================================================================
// UTILITY TYPES
// ============================================================================

/**
 * Create entity selection result with typed metadata
 */
export type CreateEntitySelection<TMeta extends Record<string, unknown>> =
    EntitySelectionResult<TMeta>

/**
 * App revision selection with app/variant metadata
 */
export interface AppRevisionSelection extends EntitySelectionResult<{
    appId: string
    appName: string
    variantId: string
    variantName: string
}> {
    type: "appRevision"
}

/**
 * Evaluator revision selection with evaluator/variant metadata
 */
export interface EvaluatorRevisionSelection extends EntitySelectionResult<{
    evaluatorId: string
    evaluatorName: string
    variantId: string
    variantName: string
}> {
    type: "evaluatorRevision"
}

/**
 * Testset revision selection with testset metadata
 */
export interface TestsetRevisionSelection extends EntitySelectionResult<{
    testsetId: string
    testsetName: string
    version: number
}> {
    type: "revision"
}
