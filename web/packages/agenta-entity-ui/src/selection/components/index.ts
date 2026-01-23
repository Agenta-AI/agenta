/**
 * Entity Selection Components
 *
 * UI components for entity selection.
 */

// Primitives - imported from @agenta/ui
export {
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
} from "@agenta/ui"

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
} from "@agenta/ui"

// ============================================================================
// UNIFIED ENTITY PICKER
// ============================================================================

/**
 * Unified EntityPicker with variant support.
 *
 * @example
 * ```tsx
 * import { EntityPicker } from '@agenta/entity-ui'
 *
 * <EntityPicker variant="cascading" adapter="appRevision" onSelect={handleSelect} />
 * <EntityPicker variant="breadcrumb" adapter="appRevision" onSelect={handleSelect} />
 * <EntityPicker variant="list-popover" adapter="testset" onSelect={handleSelect} />
 * ```
 */
export {
    EntityPicker,
    // Variant components (for advanced usage)
    CascadingVariant,
    BreadcrumbVariant,
    ListPopoverVariant,
    // Shared components (for customization)
    LevelSelect,
    ChildPopoverContent,
    AutoSelectHandler,
} from "./UnifiedEntityPicker"

export type {
    EntityPickerVariant,
    EntityPickerProps,
    EntityPickerBaseProps,
    CascadingVariantProps,
    BreadcrumbVariantProps,
    ListPopoverVariantProps,
    LevelSelectProps,
    ChildPopoverContentProps,
    AutoSelectHandlerProps,
} from "./UnifiedEntityPicker"

// ============================================================================
// MODAL
// ============================================================================

export {EntitySelectorModal} from "./EntitySelectorModal"
export type {EntitySelectorModalProps} from "./EntitySelectorModal"

// Hook
export {useEntitySelector} from "./hooks"
export type {UseEntitySelectorResult} from "./hooks"
