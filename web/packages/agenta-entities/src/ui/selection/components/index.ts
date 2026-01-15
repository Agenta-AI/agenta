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

// Main components
export {EntityPicker} from "./EntityPicker"
export type {EntityPickerProps} from "./EntityPicker"

export {EntityCascader} from "./EntityCascader"
export type {EntityCascaderProps} from "./EntityCascader"

export {EntityListWithPopover} from "./EntityListWithPopover"
export type {EntityListWithPopoverProps} from "./EntityListWithPopover"

export {EntitySelectorModal} from "./EntitySelectorModal"
export type {EntitySelectorModalProps} from "./EntitySelectorModal"

// Hook
export {useEntitySelector} from "./hooks"
export type {UseEntitySelectorResult} from "./hooks"
