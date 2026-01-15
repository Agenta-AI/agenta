/**
 * useMultiSelect Hook
 *
 * Primitive hook for multi-selection with limits and batch operations.
 */

import {useState, useCallback, useMemo} from "react"

// ============================================================================
// TYPES
// ============================================================================

export interface UseMultiSelectOptions<T> {
    /**
     * Maximum number of selections allowed
     * @default Infinity
     */
    maxSelections?: number

    /**
     * Initial selections
     */
    initialSelections?: T[]

    /**
     * Get unique ID from item
     */
    getId: (item: T) => string

    /**
     * Callback when selections change
     */
    onChange?: (selections: T[]) => void
}

export interface UseMultiSelectResult<T> {
    /**
     * Current selections
     */
    selections: T[]

    /**
     * Selection IDs for fast lookup
     */
    selectionIds: Set<string>

    /**
     * Check if an item is selected
     */
    isSelected: (item: T) => boolean

    /**
     * Toggle an item's selection
     */
    toggle: (item: T) => void

    /**
     * Select an item (if not already selected)
     */
    select: (item: T) => void

    /**
     * Deselect an item
     */
    deselect: (item: T) => void

    /**
     * Select multiple items
     */
    selectAll: (items: T[]) => void

    /**
     * Clear all selections
     */
    clearAll: () => void

    /**
     * Replace all selections
     */
    setSelections: (items: T[]) => void

    /**
     * Whether more items can be selected
     */
    canSelectMore: boolean

    /**
     * Number of remaining slots
     */
    remainingSlots: number

    /**
     * Current selection count
     */
    count: number

    /**
     * Maximum selections allowed
     */
    maxSelections: number
}

// ============================================================================
// HOOK
// ============================================================================

/**
 * Hook for managing multi-selection state
 *
 * @example
 * ```typescript
 * const {
 *   selections,
 *   isSelected,
 *   toggle,
 *   selectAll,
 *   clearAll,
 *   canSelectMore
 * } = useMultiSelect({
 *   maxSelections: 5,
 *   getId: (item) => item.id,
 *   onChange: (selections) => console.log('Changed:', selections),
 * })
 * ```
 */
export function useMultiSelect<T>(options: UseMultiSelectOptions<T>): UseMultiSelectResult<T> {
    const {maxSelections = Infinity, initialSelections = [], getId, onChange} = options

    const [selections, setSelectionsInternal] = useState<T[]>(initialSelections)

    // Derived state
    const selectionIds = useMemo(() => new Set(selections.map(getId)), [selections, getId])

    const canSelectMore = selections.length < maxSelections
    const remainingSlots = Math.max(0, maxSelections - selections.length)
    const count = selections.length

    // Helper to update selections with callback
    const updateSelections = useCallback(
        (newSelections: T[]) => {
            setSelectionsInternal(newSelections)
            onChange?.(newSelections)
        },
        [onChange],
    )

    // Check if selected
    const isSelected = useCallback(
        (item: T): boolean => {
            return selectionIds.has(getId(item))
        },
        [selectionIds, getId],
    )

    // Toggle selection
    const toggle = useCallback(
        (item: T) => {
            const id = getId(item)

            if (selectionIds.has(id)) {
                // Deselect
                updateSelections(selections.filter((s) => getId(s) !== id))
            } else if (canSelectMore) {
                // Select
                updateSelections([...selections, item])
            }
        },
        [selectionIds, getId, canSelectMore, selections, updateSelections],
    )

    // Select single item
    const select = useCallback(
        (item: T) => {
            if (!isSelected(item) && canSelectMore) {
                updateSelections([...selections, item])
            }
        },
        [isSelected, canSelectMore, selections, updateSelections],
    )

    // Deselect single item
    const deselect = useCallback(
        (item: T) => {
            const id = getId(item)
            if (selectionIds.has(id)) {
                updateSelections(selections.filter((s) => getId(s) !== id))
            }
        },
        [selectionIds, getId, selections, updateSelections],
    )

    // Select multiple items
    const selectAll = useCallback(
        (items: T[]) => {
            const newItems = items.filter((item) => !selectionIds.has(getId(item)))
            const availableSlots = maxSelections - selections.length
            const itemsToAdd = newItems.slice(0, availableSlots)

            if (itemsToAdd.length > 0) {
                updateSelections([...selections, ...itemsToAdd])
            }
        },
        [selectionIds, getId, maxSelections, selections, updateSelections],
    )

    // Clear all
    const clearAll = useCallback(() => {
        updateSelections([])
    }, [updateSelections])

    // Set selections (replace)
    const setSelections = useCallback(
        (items: T[]) => {
            const limited = items.slice(0, maxSelections)
            updateSelections(limited)
        },
        [maxSelections, updateSelections],
    )

    return {
        selections,
        selectionIds,
        isSelected,
        toggle,
        select,
        deselect,
        selectAll,
        clearAll,
        setSelections,
        canSelectMore,
        remainingSlots,
        count,
        maxSelections,
    }
}
