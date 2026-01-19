/**
 * Entity Selection System
 *
 * Unified selection components for hierarchical entity navigation.
 *
 * @example
 * ```typescript
 * // Use primitive hooks for custom implementations
 * import { useHierarchicalSelection, useMultiSelect } from '@agenta/entities/ui/selection'
 *
 * // Use pre-built adapters
 * import { appRevisionAdapter, testsetAdapter } from '@agenta/entities/ui/selection'
 *
 * // Use controller for modal management
 * import { entitySelectorController } from '@agenta/entities/ui/selection'
 * ```
 */

// Types
export type {
    SelectableEntityType,
    EntitySelectionResult,
    SelectionPathItem,
    HierarchyLevel,
    HierarchyConfig,
    EntitySelectionAdapter,
    HierarchicalSelectionState,
    EntitySelectorConfig,
    EntitySelectorResolver,
    ListQueryState,
    // Pagination types
    PaginationParams,
    PaginationInfo,
    PaginatedListQueryState,
} from "./types"

// Adapters
export {
    createAdapter,
    registerSelectionAdapter,
    getSelectionAdapter,
    hasSelectionAdapter,
    getRegisteredAdapterNames,
    clearSelectionAdapterRegistry,
    createAndRegisterAdapter,
    resolveAdapter,
} from "./adapters"

export type {
    CreateHierarchyLevelOptions,
    CreateSelectionAdapterOptions,
    AdapterRegistryEntry,
    AdapterRegistry,
} from "./adapters"

// State
export {
    // Selection molecule
    selectionMolecule,
    selectionStateFamily,
    currentPathFamily,
    currentLevelFamily,
    searchTermFamily,
    isAtRootFamily,
    currentParentIdFamily,
    navigateDownFamily,
    navigateUpFamily,
    navigateToLevelFamily,
    setSearchTermFamily,
    resetSelectionFamily,
    setPathFamily,
    // Modal controller
    entitySelectorController,
    entitySelectorOpenAtom,
    entitySelectorConfigAtom,
    entitySelectorResolverAtom,
    entitySelectorActiveTypeAtom,
    entitySelectorAllowedTypesAtom,
    entitySelectorTitleAtom,
    entitySelectorAdaptersAtom,
    resetEntitySelectorAtom,
    openEntitySelectorAtom,
    closeEntitySelectorWithSelectionAtom,
    closeEntitySelectorAtom,
    forceCloseEntitySelectorAtom,
    setEntitySelectorActiveTypeAtom,
} from "./state"

// Hooks
export {
    useEntityList,
    useInfiniteList,
    useSimpleInfiniteList,
    useHierarchicalSelection,
    useMultiSelect,
    useLazyChildren,
} from "./hooks"

export type {
    UseEntityListOptions,
    UseEntityListResult,
    UseInfiniteListOptions,
    UseInfiniteListResult,
    UseSimpleInfiniteListOptions,
    UseSimpleInfiniteListResult,
    UseHierarchicalSelectionOptions,
    UseHierarchicalSelectionResult,
    UseMultiSelectOptions,
    UseMultiSelectResult,
    UseLazyChildrenOptions,
    UseLazyChildrenResult,
    CascaderOption,
} from "./hooks"

// Components
export {
    // Primitives
    EntityBreadcrumb,
    EntityListItem,
    SearchInput,
    // Virtualized list components
    VirtualEntityList,
    SimpleEntityList,
    AdaptiveEntityList,
    // Load more components
    LoadMoreButton,
    LoadMoreInline,
    EndOfList,
    // Load all components
    LoadAllButton,
    LoadAllInline,
    // Main components
    EntityPicker,
    EntityCascader,
    EntityListWithPopover,
    EntitySelectorModal,
    // Hook
    useEntitySelector,
} from "./components"

export type {
    EntityBreadcrumbProps,
    EntityListItemProps,
    SearchInputProps,
    VirtualEntityListProps,
    SimpleEntityListProps,
    AdaptiveEntityListProps,
    LoadMoreButtonProps,
    LoadMoreInlineProps,
    EndOfListProps,
    LoadAllButtonProps,
    LoadAllInlineProps,
    EntityPickerProps,
    EntityCascaderProps,
    EntityListWithPopoverProps,
    EntitySelectorModalProps,
    UseEntitySelectorResult,
} from "./components"

// Pre-built adapters
export {
    appRevisionAdapter,
    setAppRevisionAtoms,
    evaluatorRevisionAdapter,
    setEvaluatorRevisionAtoms,
    testsetAdapter,
    setTestsetAtoms,
} from "./adapters"

export type {
    AppRevisionSelectionResult,
    EvaluatorRevisionSelectionResult,
    TestsetSelectionResult,
} from "./adapters"

// Initialization
export {
    initializeSelectionSystem,
    resetSelectionSystem,
    isSelectionSystemInitialized,
} from "./initializeSelection"

export type {
    SelectionSystemConfig,
    TestsetSelectionConfig,
    AppRevisionSelectionConfig,
    EvaluatorRevisionSelectionConfig,
} from "./initializeSelection"
