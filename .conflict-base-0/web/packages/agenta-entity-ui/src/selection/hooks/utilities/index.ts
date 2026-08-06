/**
 * Entity Selection Utilities
 *
 * Shared utilities for entity selection hooks.
 */

// Auto-select utilities
export {
    useAutoSelect,
    useAutoSelectCallback,
    calculateAutoSelectState,
    type AutoSelectOptions,
    type AutoSelectResult,
    type CalculateAutoSelectOptions,
    type CalculateAutoSelectResult,
    type UseAutoSelectCallbackOptions,
} from "./useAutoSelect"

// Level data utilities
export {
    useLevelData,
    usePaginatedLevelData,
    resolveListAtom,
    filterItems,
    createLabelFilter,
    type LevelQueryState,
    type UseLevelDataOptions,
    type UseLevelDataResult,
    type UsePaginatedLevelDataOptions,
    type UsePaginatedLevelDataResult,
} from "./useLevelData"

// Path builder utilities
export {
    usePathBuilder,
    useSelectionCallback,
    usePathMemo,
    buildPath,
    buildPathItem,
    isPathComplete,
    findEntityInItems,
    getPathIds,
    getPathIdAtLevel,
    type LevelState,
    type UsePathBuilderOptions,
    type UsePathBuilderResult,
    type UseSelectionCallbackOptions,
} from "./usePathBuilder"
