import {atom} from "jotai"
import {atomFamily} from "jotai/utils"

import type {FlattenedTestcase} from "./schema"
import {
    deletedEntityIdsAtom,
    newEntityIdsAtom,
    testcaseCellAtomFamily as entityCellAtomFamily,
    testcaseEntityAtomFamily,
    testcaseHasDraftAtomFamily,
    testcaseIdsAtom,
} from "./testcaseEntity"

// ============================================================================
// DISPLAY ROWS (DERIVED)
// Returns row references (IDs) instead of full data
// Cells read from entity atoms directly for optimized re-renders
// ============================================================================

/**
 * Row reference for table display
 * Contains only metadata needed for rendering - cells read data from entity atoms
 * Extends InfiniteTableRowBase for compatibility with table components
 */
export interface DisplayRowRef {
    id: string
    key: React.Key
    __isSkeleton: boolean
    __isNew?: boolean
    [key: string]: unknown
}

/**
 * Legacy DisplayRow type for backward compatibility
 * @deprecated Use DisplayRowRef + cell selectors instead
 */
export interface DisplayRow extends FlattenedTestcase {
    key: string
    __isSkeleton?: boolean
    __isNew?: boolean
}

/**
 * Derived atom: get display row references for the table
 * Returns only IDs/metadata - NOT full data
 *
 * This is optimized: the table structure only changes when:
 * - New rows are added
 * - Rows are deleted
 * - Server data changes (pagination)
 *
 * Individual cell data changes don't cause this atom to update.
 * Cells read from testcaseCellAtomFamily for their specific data.
 */
export const displayRowRefsAtom = atom((get): DisplayRowRef[] => {
    // Server IDs from paginated query (set by hook)
    const serverIds = get(testcaseIdsAtom)
    // New entity IDs (created locally, not yet saved)
    const newIds = get(newEntityIdsAtom)
    // Deleted IDs (soft deleted, pending save)
    const deletedIds = get(deletedEntityIdsAtom)

    const refs: DisplayRowRef[] = []

    // 1. Add new rows first (prepended at top, reversed so newest is first)
    const reversedNewIds = [...newIds].reverse()
    reversedNewIds.forEach((id) => {
        if (!deletedIds.has(id)) {
            refs.push({
                id,
                key: id,
                __isSkeleton: false,
                __isNew: true,
            })
        }
    })

    // 2. Add server row IDs (excluding deleted)
    serverIds.forEach((id) => {
        if (deletedIds.has(id)) return

        refs.push({
            id,
            key: id,
            __isSkeleton: false,
            __isNew: false,
        })
    })

    return refs
})

/**
 * Derived atom: get just the row IDs in display order
 */
export const displayRowIdsAtom = atom((get): string[] => {
    const refs = get(displayRowRefsAtom)
    return refs.map((ref) => ref.id)
})

// ============================================================================
// CELL SELECTORS (OPTIMIZED)
// Re-export from testcaseEntity for convenience
// ============================================================================

/**
 * Atom family for reading a specific cell value
 * Only re-renders when THIS specific cell's value changes
 *
 * Usage: const cellValue = useAtomValue(testcaseCellAtomFamily({id: rowId, column: 'input'}))
 */
export const testcaseCellAtomFamily = entityCellAtomFamily

/**
 * Atom family for reading a full row (when needed)
 * Prefer testcaseCellAtomFamily for individual cells
 */
export const testcaseRowAtomFamily = atomFamily((id: string) =>
    atom((get): FlattenedTestcase | null => {
        return get(testcaseEntityAtomFamily(id))
    }),
)

/**
 * Atom family for checking if a row is new
 */
export const isRowNewAtomFamily = atomFamily((id: string) =>
    atom((get): boolean => {
        const newIds = get(newEntityIdsAtom)
        return newIds.includes(id)
    }),
)

/**
 * Atom family for checking if a row is deleted
 */
export const isRowDeletedAtomFamily = atomFamily((id: string) =>
    atom((get): boolean => {
        const deletedIds = get(deletedEntityIdsAtom)
        return deletedIds.has(id)
    }),
)

/**
 * Atom family for checking if a row has local edits (draft)
 */
export const isRowDirtyAtomFamily = atomFamily((id: string) =>
    atom((get): boolean => {
        return get(testcaseHasDraftAtomFamily(id))
    }),
)

// ============================================================================
// LEGACY SUPPORT
// Keep displayRowsAtom for backward compatibility during migration
// ============================================================================

/**
 * @deprecated Use displayRowRefsAtom + testcaseCellAtomFamily instead
 * This constructs full row objects which causes unnecessary re-renders
 */
export const displayRowsAtom = atom((get): DisplayRow[] => {
    const refs = get(displayRowRefsAtom)

    const rows: DisplayRow[] = []

    refs.forEach((ref) => {
        const entity = get(testcaseEntityAtomFamily(ref.id))
        if (entity) {
            rows.push({
                ...entity,
                key: ref.id,
                __isSkeleton: false,
                __isNew: ref.__isNew,
            })
        }
    })

    return rows
})
