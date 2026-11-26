/**
 * Testcase Data Controller
 *
 * Unified API for testcase data access that abstracts the data source (local vs server).
 * This enables shared components to work with testcase data without knowing the source.
 *
 * Built using `createEntityDataController` factory from `@agenta/entities/shared`,
 * which provides selection management, derived selectors, and cleanup.
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

import {atom} from "jotai"
import {atomFamily} from "jotai-family"

import {
    createEntityDataController,
    type EntityDataConfigBase,
} from "../../shared/createEntityDataController"
import {extractColumnsWithAccessor, type Column} from "../core"

import {testcaseMolecule} from "./molecule"
import {testcasePaginatedStore, type TestcaseTableRow} from "./paginatedStore"
import {testcaseEntityAtomFamily} from "./store"

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
export interface TestcaseDataConfig extends EntityDataConfigBase {
    /** Revision ID for server data (null for local-only mode) */
    revisionId?: string | null
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
    /**
     * Keep unsaved local rows (ids with the `new-` prefix) in server mode.
     * An edit session needs them; a read-only table does not. Default: false.
     */
    includeNewRows?: boolean
    /** Shows only the loaded rows with a value that contains this text (any case). */
    searchTerm?: string
}

/** Whether a cell value, or a value nested in it, contains the search text. */
const valueMatches = (value: unknown, term: string): boolean => {
    if (value === null || value === undefined) return false
    const text = typeof value === "string" ? value : JSON.stringify(value)
    return text.toLowerCase().includes(term)
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
        a.localColumnKeys === b.localColumnKeys &&
        a.includeNewRows === b.includeNewRows &&
        a.searchTerm === b.searchTerm
    )
}

// ============================================================================
// ENTITY-SPECIFIC DATA SELECTORS
// ============================================================================

/**
 * Rows selector - returns testcase rows from the appropriate source.
 *
 * Note: TestcaseTableRow is identity-only ({id, key, flags}).
 * Cell data is accessed via testcaseCellAtomFamily(id, column) which reads from testcase.data.
 */
const rowsAtomFamily = atomFamily((config: TestcaseDataConfig) => {
    return atom((get): TestcaseTableRow[] => {
        // Local mode - use molecule or provided rows
        if (config.useLocal) {
            // Use provided local rows if available
            if (config.localRows && config.localRows.length > 0) {
                // Local rows are identity-only, data accessed via cell atoms
                return config.localRows.map((row) => ({
                    id: row.id,
                    key: row.id,
                    __isNew: true,
                })) as TestcaseTableRow[]
            }

            // Fallback to molecule display rows
            const localIds = get(testcaseMolecule.atoms.displayRowIds)
            return localIds.map((id) => ({
                id,
                key: id,
                __isNew: id.startsWith("new-"),
            })) as TestcaseTableRow[]
        }

        // Server mode - use paginated store
        const paginatedParams = {
            scopeId: config.scopeId,
            pageSize: config.pageSize ?? 100,
        }
        const state = get(testcasePaginatedStore.selectors.state(paginatedParams))

        // Filter out skeleton rows, and new rows unless the table is an edit session
        const rows = state.rows.filter(
            (row) => !row.__isSkeleton && (config.includeNewRows || !row.__isNew),
        )
        const term = config.searchTerm?.trim().toLowerCase()
        if (!term) return rows
        return rows.filter((row) => {
            const data = get(testcaseEntityAtomFamily(row.id))?.data
            return !!data && Object.values(data).some((value) => valueMatches(value, term))
        })
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
 * Columns selector - extracts columns from testcase data.
 *
 * Note: Testcases use nested format (testcase.data), so we need to
 * access the entity data to extract columns.
 */
const columnsAtomFamily = atomFamily((config: TestcaseDataConfig) => {
    return atom((get): Column[] => {
        // Use provided column keys for local mode
        if (config.useLocal && config.localColumnKeys && config.localColumnKeys.length > 0) {
            return config.localColumnKeys.map((key) => ({key, label: key}))
        }

        // The first rows of the whole list, so a search does not hide columns, plus every row the
        // search matches, so a matching row past the sample still shows its columns.
        const sample = get(
            rowsAtomFamily(config.searchTerm ? {...config, searchTerm: undefined} : config),
        ).slice(0, 20)
        if (config.searchTerm) {
            const sampled = new Set(sample.map((row) => row.id))
            for (const row of get(rowsAtomFamily(config))) {
                if (!sampled.has(row.id)) sample.push(row)
            }
        }

        // Extract columns from entity data (testcase.data)
        // We need to look up entity data for each row since rows are identity-only.
        // In server mode the read subscribes to the entity, which carries the pending column
        // renames, adds and removals, so the headers follow a column edit at once.
        const dataObjects: Record<string, unknown>[] = []
        for (const row of sample) {
            const entity = config.useLocal
                ? testcaseMolecule.get.data(row.id)
                : get(testcaseEntityAtomFamily(row.id))
            if (entity?.data) {
                dataObjects.push(entity.data as Record<string, unknown>)
            }
        }

        // Each object is already row data, so a user column named `id` or `data` stays a column.
        return extractColumnsWithAccessor(dataObjects, (data) => data, {
            sampleSize: dataObjects.length,
        })
    })
}, areConfigsEqual)

// ============================================================================
// CONTROLLER (built with factory)
// ============================================================================

/**
 * List counts selector - returns list counts from paginated store or local fallback
 */
const countsAtomFamily = atomFamily((config: TestcaseDataConfig) => {
    return atom((get) => {
        // Local mode - compute counts from local rows
        if (config.useLocal) {
            const rows = get(rowsAtomFamily(config))
            const loadedCount = rows.length
            return {
                loadedCount,
                totalCount: loadedCount,
                hasMore: false,
                isTotalKnown: true,
                displayLabel: String(loadedCount),
                displayLabelShort: String(loadedCount),
                displaySuffix: "" as const,
            }
        }

        // Server mode - use paginated store's listCounts
        const paginatedParams = {
            scopeId: config.scopeId,
            pageSize: config.pageSize ?? 100,
        }
        return get(testcasePaginatedStore.selectors.listCounts(paginatedParams))
    })
}, areConfigsEqual)

/**
 * Testcase Data Controller
 *
 * Unified API for testcase data access that abstracts the data source.
 * Selection state, derived selectors, and actions are provided by the
 * `createEntityDataController` factory.
 */
export const testcaseDataController = createEntityDataController<
    TestcaseTableRow,
    TestcaseDataConfig,
    Column
>({
    rows: (config) => rowsAtomFamily(config),
    isLoading: (config) => isLoadingAtomFamily(config),
    columns: (config) => columnsAtomFamily(config),
    configEquals: areConfigsEqual,
    counts: (config) => countsAtomFamily(config),
})

/**
 * Loads the next page of a server-mode table, when there is one and no page is loading.
 *
 * The grid calls it when the reader scrolls near the end. Rows on later pages join the same
 * row list, so an edit to one of them reaches the save like an edit on the first page.
 * Local mode has one page and does nothing. The rule is the one `useInfiniteTablePagination`
 * uses; this atom runs it outside React so the grid does not re-render on every page change.
 */
export const loadMoreTestcasesAtom = atom(null, (get, set, config: TestcaseDataConfig) => {
    if (config.useLocal) return
    const key = {scopeId: config.scopeId, pageSize: config.pageSize ?? 100}
    const tableAtoms = testcasePaginatedStore.store.store.atoms
    const info = get(tableAtoms.paginationInfoAtomFamily(key))
    if (!info.hasMore || !info.nextCursor || info.isFetching) return
    const totalRows = get(tableAtoms.combinedRowsAtomFamily(key)).length
    set(tableAtoms.scheduleNextPageAtomFamily(key), {
        nextCursor: info.nextCursor,
        nextOffset: info.nextOffset ?? totalRows,
        nextWindowing: info.nextWindowing ?? {
            next: info.nextCursor,
            order: "ascending",
            limit: key.pageSize,
            stop: null,
        },
        totalRows,
    })
})
