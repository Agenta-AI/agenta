/**
 * Entity Selection System
 *
 * Unified selection components for hierarchical entity navigation.
 *
 * @example
 * ```typescript
 * // Use the unified EntityPicker with variant prop
 * import { EntityPicker } from '@agenta/entity-ui/selection'
 *
 * <EntityPicker variant="cascading" adapter="appRevision" onSelect={handleSelect} />
 * <EntityPicker variant="breadcrumb" adapter="appRevision" onSelect={handleSelect} />
 * <EntityPicker variant="list-popover" adapter="testset" onSelect={handleSelect} />
 *
 * // Use the unified hooks
 * import { useCascadingMode, useBreadcrumbMode, useListPopoverMode } from '@agenta/entity-ui/selection'
 *
 * // Use pre-built adapters
 * import { appRevisionAdapter, testsetAdapter } from '@agenta/entity-ui/selection'
 *
 * // Use controller for modal management
 * import { entitySelectorController } from '@agenta/entity-ui/selection'
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
    // Unified hooks
    useEntitySelection,
    useCascadingMode,
    useBreadcrumbMode,
    useListPopoverMode,
    useEntitySelectionCore,
    // Utilities
    getLevelLabel,
    getLevelPlaceholder,
    useChildrenData,
    useAutoSelectLatestChild,
} from "./hooks"

export type {
    // Unified hook types
    EntitySelectionMode,
    UseEntitySelectionOptions,
    UseEntitySelectionResult,
    CascadingModeOptions,
    BreadcrumbModeOptions,
    ListPopoverModeOptions,
    UseCascadingModeOptions,
    UseCascadingModeResult,
    UseBreadcrumbModeOptions,
    UseBreadcrumbModeResult,
    UseListPopoverModeOptions,
    UseListPopoverModeResult,
    CascadingLevelState,
    ListPopoverParentState,
    ListPopoverChildrenState,
    EntitySelectionCoreOptions,
    EntitySelectionCoreResult,
    UseAutoSelectLatestChildOptions,
} from "./hooks"

// Components
export {
    // Primitives (from @agenta/ui)
    EntityBreadcrumb,
    EntityListItem,
    SearchInput,
    VirtualEntityList,
    SimpleEntityList,
    AdaptiveEntityList,
    LoadMoreButton,
    LoadMoreInline,
    EndOfList,
    LoadAllButton,
    LoadAllInline,
    // Unified EntityPicker with variants
    EntityPicker,
    CascadingVariant,
    BreadcrumbVariant,
    ListPopoverVariant,
    TreeSelectPopupContent,
    // Shared components (for customization)
    LevelSelect,
    ChildPopoverContent,
    AutoSelectHandler,
    // Modal
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
    EntityPickerVariant,
    EntityPickerProps,
    EntityPickerBaseProps,
    CascadingVariantProps,
    BreadcrumbVariantProps,
    ListPopoverVariantProps,
    TreeSelectPopupContentProps,
    LevelSelectProps,
    ChildPopoverContentProps,
    AutoSelectHandlerProps,
    EntitySelectorModalProps,
    UseEntitySelectorResult,
} from "./components"

// Pre-built adapters
export {
    appRevisionAdapter,
    ossAppRevisionAdapter,
    createOssAppRevisionAdapter,
    evaluatorRevisionAdapter,
    setEvaluatorRevisionAtoms,
    testsetAdapter,
} from "./adapters"

export type {
    AppRevisionSelectionResult,
    OssAppRevisionSelectionResult,
    CreateOssAppRevisionAdapterOptions,
    EvaluatorRevisionSelectionResult,
    TestsetSelectionResult,
} from "./adapters"

// Initialization
export {
    initializeSelectionSystem,
    resetSelectionSystem,
    isSelectionSystemInitialized,
} from "./initializeSelection"

export type {SelectionSystemConfig, EvaluatorRevisionSelectionConfig} from "./initializeSelection"
