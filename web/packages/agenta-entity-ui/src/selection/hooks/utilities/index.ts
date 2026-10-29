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
export {buildPath, buildPathItem, isPathComplete, type LevelState} from "./usePathBuilder"
