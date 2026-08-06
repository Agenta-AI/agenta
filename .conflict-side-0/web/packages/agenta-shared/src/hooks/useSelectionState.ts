/**
 * useSelectionState Hook
 *
 * A reusable hook for computing selection state from a list of IDs.
 * Handles both Set and array inputs, and computes isAllSelected/isSomeSelected.
 *
 * @example
 * ```typescript
 * import { useSelectionState } from '@agenta/shared'
 *
 * const { selectedSet, isAllSelected, isSomeSelected } = useSelectionState(
 *   allRowIds,
 *   selectedIds // can be string[] or Set<string>
 * )
 * ```
 */

import {useMemo} from "react"

export interface UseSelectionStateResult {
    /** Selected IDs as a Set for O(1) lookups */
    selectedSet: Set<string>
    /** True if all items are selected */
    isAllSelected: boolean
    /** True if some (but not all) items are selected - useful for indeterminate checkbox state */
    isSomeSelected: boolean
    /** Number of selected items */
    selectedCount: number
}

/**
 * Compute selection state from a list of all IDs and selected IDs.
 *
 * @param allIds - Array of all available IDs
 * @param selectedIds - Selected IDs as array or Set
 * @returns Selection state with computed properties
 */
export function useSelectionState(
    allIds: string[],
    selectedIds: string[] | Set<string>,
): UseSelectionStateResult {
    return useMemo(() => {
        const selectedSet = selectedIds instanceof Set ? selectedIds : new Set(selectedIds)
        const selectedCount = allIds.filter((id) => selectedSet.has(id)).length
        const isAllSelected = allIds.length > 0 && selectedCount === allIds.length
        const isSomeSelected = selectedCount > 0 && selectedCount < allIds.length

        return {selectedSet, isAllSelected, isSomeSelected, selectedCount}
    }, [allIds, selectedIds])
}
