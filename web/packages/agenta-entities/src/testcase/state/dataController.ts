/**
 * Testcase Data Controller
 *
 * Unified API for testcase data access that abstracts the data source (local vs server).
 * This enables shared components to work with testcase data without knowing the source.
 *
 * ## Memory Management
 *
 * This controller uses `atomFamily` for scoped state (selection, rows, etc.). To prevent
 * memory leaks, consumers MUST call `resetSelection` when a scope is destroyed:
 *
 * ```typescript
 * useEffect(() => {
 *   return () => resetSelection(config.scopeId)
 * }, [config.scopeId])
 * ```
 *
 * Additionally, configs passed to selectors should be memoized to avoid creating new
 * atom instances on every render:
 *
 * ```typescript
 * const config = useMemo(() => ({
 *   scopeId: 'my-table',
 *   revisionId: 'rev-123',
 * }), [revisionId])
 * ```
 *
 * @example
 * ```typescript
 * import { testcaseDataController } from '@agenta/entities/testcase'
 *
 * // Configure data source (memoize in components!)
 * const config = useMemo(() => ({ revisionId: 'rev-123', scopeId: 'my-table' }), [])
 *
 * // Use unified selectors
 * const rows = useAtomValue(testcaseDataController.selectors.rows(config))
 * const isLoading = useAtomValue(testcaseDataController.selectors.isLoading(config))
 * const columns = useAtomValue(testcaseDataController.selectors.columns(config))
 *
 * // Selection management
 * const selectedIds = useAtomValue(testcaseDataController.selectors.selectedIds(config.scopeId))
 * const setSelection = useSetAtom(testcaseDataController.actions.setSelection)
 * setSelection(config.scopeId, ['id1', 'id2'])
 *
 * // Cleanup on unmount
 * const resetSelection = useSetAtom(testcaseDataController.actions.resetSelection)
 * useEffect(() => () => resetSelection(config.scopeId), [config.scopeId])
 * ```
 */

import {atom, type Atom, type PrimitiveAtom} from "jotai"
import {atomFamily} from "jotai-family"

import {extractColumnsFromData, type Column} from "../core"

import {testcaseMolecule} from "./molecule"
import {testcasePaginatedStore, type TestcaseTableRow} from "./paginatedStore"

// ============================================================================
// TYPES
// ============================================================================

/**
 * Configuration for testcase data source
 *
 * **Important:** When using `localRows`, the array reference must be memoized
 * (e.g., via `useMemo`) to prevent unnecessary atom recreation. The equality
 * check uses reference equality for performance.
 */
export interface TestcaseDataConfig {
    /** Revision ID for server data (null for local-only mode) */
    revisionId?: string | null
    /** Unique scope ID for this data instance (used for selection state) */
    scopeId: string
    /** Page size for paginated fetching (default: 100) */
    pageSize?: number
    /** Use local testcases from molecule instead of server (default: false) */
    useLocal?: boolean
    /**
     * Pre-built local rows (from loadable controller or other source).
     * **Must be memoized** - uses reference equality for performance.
     */
    localRows?: {id: string; data: Record<string, unknown>}[]
    /** Column keys for local mode (when data might be empty) */
    localColumnKeys?: string[]
}

/**
 * Compare two configs for equality (used by atomFamily)
 */
function areConfigsEqual(a: TestcaseDataConfig, b: TestcaseDataConfig): boolean {
    return (
        a.scopeId === b.scopeId &&
        a.revisionId === b.revisionId &&
        a.useLocal === b.useLocal &&
        a.pageSize === b.pageSize &&
        a.localRows === b.localRows &&
        a.localColumnKeys === b.localColumnKeys
    )
}

// ============================================================================
// SELECTION STATE
// ============================================================================

/**
 * Selection state per scope - stores selected testcase IDs
 */
export const testcaseSelectionAtomFamily = atomFamily(
    (_scopeId: string) => atom<Set<string>>(new Set<string>()) as PrimitiveAtom<Set<string>>,
)

/**
 * Set selection for a scope
 */
export const setTestcaseSelectionAtom = atom(
    null,
    (_get, set, scopeId: string, selectedIds: string[]) => {
        set(testcaseSelectionAtomFamily(scopeId), new Set(selectedIds))
    },
)

/**
 * Toggle a single testcase selection
 */
export const toggleTestcaseSelectionAtom = atom(
    null,
    (get, set, scopeId: string, testcaseId: string, multiSelect = true) => {
        const current = get(testcaseSelectionAtomFamily(scopeId))
        const newSet = new Set(current)

        if (multiSelect) {
            if (newSet.has(testcaseId)) {
                newSet.delete(testcaseId)
            } else {
                newSet.add(testcaseId)
            }
        } else {
            // Single select mode - clear and set
            newSet.clear()
            if (!current.has(testcaseId)) {
                newSet.add(testcaseId)
            }
        }

        set(testcaseSelectionAtomFamily(scopeId), newSet)
    },
)

/**
 * Select all testcases in scope
 */
export const selectAllTestcasesAtom = atom(null, (_get, set, scopeId: string, allIds: string[]) => {
    set(testcaseSelectionAtomFamily(scopeId), new Set(allIds))
})

/**
 * Clear selection for a scope
 */
export const clearTestcaseSelectionAtom = atom(null, (_get, set, scopeId: string) => {
    set(testcaseSelectionAtomFamily(scopeId), new Set<string>())
})

/**
 * Reset selection for a scope (removes the atom from the family cache)
 * Use this when a scope is being destroyed to prevent memory leaks
 */
export const resetTestcaseSelectionAtom = atom(null, (_get, _set, scopeId: string) => {
    // Clear the selection and remove from cache
    testcaseSelectionAtomFamily.remove(scopeId)
})

// ============================================================================
// DATA SELECTORS
// ============================================================================

/**
 * Rows selector - returns testcase rows from the appropriate source
 */
const rowsAtomFamily = atomFamily((config: TestcaseDataConfig) => {
    return atom((get): TestcaseTableRow[] => {
        // Local mode - use molecule or provided rows
        if (config.useLocal) {
            // Use provided local rows if available
            if (config.localRows && config.localRows.length > 0) {
                return config.localRows.map((row) => ({
                    id: row.id,
                    key: row.id,
                    ...row.data,
                })) as TestcaseTableRow[]
            }

            // Fallback to molecule display rows
            const localIds = get(testcaseMolecule.atoms.displayRowIds)
            return localIds.map((id) => {
                const data = testcaseMolecule.get.data(id)
                return {
                    id,
                    key: id,
                    ...data,
                } as TestcaseTableRow
            })
        }

        // Server mode - use paginated store
        const paginatedParams = {
            scopeId: config.scopeId,
            pageSize: config.pageSize ?? 100,
        }
        const state = get(testcasePaginatedStore.selectors.state(paginatedParams))

        // Filter out skeleton and new rows for server mode
        return state.rows.filter((row) => !row.__isNew && !row.__isSkeleton)
    })
}, areConfigsEqual)

/**
 * Loading state selector
 */
const isLoadingAtomFamily = atomFamily((config: TestcaseDataConfig) => {
    return atom((get): boolean => {
        // Local mode is never loading
        if (config.useLocal) {
            return false
        }

        // Server mode - check paginated store
        const paginatedParams = {
            scopeId: config.scopeId,
            pageSize: config.pageSize ?? 100,
        }
        const state = get(testcasePaginatedStore.selectors.state(paginatedParams))
        return state.isFetching
    })
}, areConfigsEqual)

/**
 * Columns selector - extracts columns from row data
 */
const columnsAtomFamily = atomFamily((config: TestcaseDataConfig) => {
    return atom((get): Column[] => {
        // Use provided column keys for local mode
        if (config.useLocal && config.localColumnKeys && config.localColumnKeys.length > 0) {
            return config.localColumnKeys.map((key) => ({key, label: key}))
        }

        // Extract columns from rows
        const rows = get(rowsAtomFamily(config))
        return extractColumnsFromData(rows as Record<string, unknown>[])
    })
}, areConfigsEqual)

/**
 * All row IDs selector (for select all functionality)
 */
const allRowIdsAtomFamily = atomFamily((config: TestcaseDataConfig) => {
    return atom((get): string[] => {
        const rows = get(rowsAtomFamily(config))
        return rows.map((row) => row.id)
    })
}, areConfigsEqual)

/**
 * Selected IDs as array selector
 */
const selectedIdsArrayAtomFamily = atomFamily((scopeId: string) => {
    return atom((get): string[] => {
        const selection = get(testcaseSelectionAtomFamily(scopeId))
        return [...selection]
    })
})

/**
 * Selected count selector
 */
const selectedCountAtomFamily = atomFamily((scopeId: string) => {
    return atom((get): number => {
        const selection = get(testcaseSelectionAtomFamily(scopeId))
        return selection.size
    })
})

/**
 * Total count selector
 */
const totalCountAtomFamily = atomFamily((config: TestcaseDataConfig) => {
    return atom((get): number => {
        const rows = get(rowsAtomFamily(config))
        return rows.length
    })
}, areConfigsEqual)

/**
 * Is all selected selector
 */
const isAllSelectedAtomFamily = atomFamily((config: TestcaseDataConfig) => {
    return atom((get): boolean => {
        const allIds = get(allRowIdsAtomFamily(config))
        const selection = get(testcaseSelectionAtomFamily(config.scopeId))
        return allIds.length > 0 && allIds.every((id) => selection.has(id))
    })
}, areConfigsEqual)

/**
 * Is some selected (for indeterminate checkbox state)
 */
const isSomeSelectedAtomFamily = atomFamily((config: TestcaseDataConfig) => {
    return atom((get): boolean => {
        const allIds = get(allRowIdsAtomFamily(config))
        const selection = get(testcaseSelectionAtomFamily(config.scopeId))
        const selectedCount = allIds.filter((id) => selection.has(id)).length
        return selectedCount > 0 && selectedCount < allIds.length
    })
}, areConfigsEqual)

// ============================================================================
// CONTROLLER EXPORT
// ============================================================================

/**
 * Testcase Data Controller
 *
 * Unified API for testcase data access that abstracts the data source.
 */
export const testcaseDataController = {
    /**
     * Selectors for reading data
     */
    selectors: {
        /** Get rows from configured data source */
        rows: (config: TestcaseDataConfig): Atom<TestcaseTableRow[]> => rowsAtomFamily(config),

        /** Check if data is loading */
        isLoading: (config: TestcaseDataConfig): Atom<boolean> => isLoadingAtomFamily(config),

        /** Get extracted columns from data */
        columns: (config: TestcaseDataConfig): Atom<Column[]> => columnsAtomFamily(config),

        /** Get all row IDs */
        allRowIds: (config: TestcaseDataConfig): Atom<string[]> => allRowIdsAtomFamily(config),

        /** Get total row count */
        totalCount: (config: TestcaseDataConfig): Atom<number> => totalCountAtomFamily(config),

        /** Get selected IDs as Set */
        selectedIds: (scopeId: string): Atom<Set<string>> => testcaseSelectionAtomFamily(scopeId),

        /** Get selected IDs as array */
        selectedIdsArray: (scopeId: string): Atom<string[]> => selectedIdsArrayAtomFamily(scopeId),

        /** Get selected count */
        selectedCount: (scopeId: string): Atom<number> => selectedCountAtomFamily(scopeId),

        /** Check if all rows are selected */
        isAllSelected: (config: TestcaseDataConfig): Atom<boolean> =>
            isAllSelectedAtomFamily(config),

        /** Check if some (but not all) rows are selected */
        isSomeSelected: (config: TestcaseDataConfig): Atom<boolean> =>
            isSomeSelectedAtomFamily(config),
    },

    /**
     * Actions for modifying state
     */
    actions: {
        /** Set selection for a scope */
        setSelection: setTestcaseSelectionAtom,

        /** Toggle a single testcase selection */
        toggleSelection: toggleTestcaseSelectionAtom,

        /** Select all testcases */
        selectAll: selectAllTestcasesAtom,

        /** Clear selection */
        clearSelection: clearTestcaseSelectionAtom,

        /** Reset selection (removes from cache - use on scope destruction) */
        resetSelection: resetTestcaseSelectionAtom,
    },
}
