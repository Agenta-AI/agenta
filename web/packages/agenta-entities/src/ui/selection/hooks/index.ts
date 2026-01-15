/**
 * Entity Selection Hooks
 *
 * Primitive hooks for building entity selection UI.
 */

// useEntityList
export {useEntityList} from "./useEntityList"
export type {UseEntityListOptions, UseEntityListResult} from "./useEntityList"

// useInfiniteList (for paginated/infinite scroll)
export {useInfiniteList, useSimpleInfiniteList} from "./useInfiniteList"
export type {
    UseInfiniteListOptions,
    UseInfiniteListResult,
    UseSimpleInfiniteListOptions,
    UseSimpleInfiniteListResult,
} from "./useInfiniteList"

// useHierarchicalSelection (supports both paginated and non-paginated modes)
export {useHierarchicalSelection} from "./useHierarchicalSelection"
export type {
    UseHierarchicalSelectionOptions,
    UseHierarchicalSelectionResult,
} from "./useHierarchicalSelection"

// useMultiSelect
export {useMultiSelect} from "./useMultiSelect"
export type {UseMultiSelectOptions, UseMultiSelectResult} from "./useMultiSelect"

// useLazyChildren
export {useLazyChildren} from "./useLazyChildren"
export type {UseLazyChildrenOptions, UseLazyChildrenResult, CascaderOption} from "./useLazyChildren"
