/**
 * Selection Components
 *
 * Generic UI components for building selection interfaces.
 * These components work with any data type and don't depend on entity-specific APIs.
 */

// Search
export {SearchInput} from "./SearchInput"
export type {SearchInputProps} from "./SearchInput"

// List items
export {ListItem, EntityListItem} from "./ListItem"
export type {ListItemProps, EntityListItemProps} from "./ListItem"

// Virtual lists
export {VirtualList, SimpleList, AdaptiveList} from "./VirtualList"
export {VirtualEntityList, SimpleEntityList, AdaptiveEntityList} from "./VirtualList"
export type {
    VirtualListProps,
    SimpleListProps,
    AdaptiveListProps,
    VirtualEntityListProps,
    SimpleEntityListProps,
    AdaptiveEntityListProps,
} from "./VirtualList"

// Load more button
export {LoadMoreButton, LoadMoreInline, EndOfList} from "./LoadMoreButton"
export type {LoadMoreButtonProps, LoadMoreInlineProps, EndOfListProps} from "./LoadMoreButton"

// Load all button
export {LoadAllButton, LoadAllInline} from "./LoadAllButton"
export type {LoadAllButtonProps, LoadAllInlineProps} from "./LoadAllButton"

// Breadcrumb
export {Breadcrumb, EntityBreadcrumb} from "./Breadcrumb"
export type {
    BreadcrumbProps,
    EntityBreadcrumbProps,
    BreadcrumbPathItem,
    SelectionPathItem,
} from "./Breadcrumb"
