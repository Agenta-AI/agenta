/**
 * Testcase Entity API
 *
 * Provides a unified, simplified API for working with testcase entities.
 * Abstracts away the complexity of multiple atoms into a single cohesive interface.
 *
 * ## Usage
 *
 * ```typescript
 * import { testcase } from '@/state/entities/testcase'
 *
 * // Option 1: Full controller (state + dispatch)
 * function TestcaseEditor({ testcaseId }: { testcaseId: string }) {
 *   const [tc, dispatch] = useAtom(testcase.controller(testcaseId))
 *
 *   if (tc.isPending) return <Skeleton />
 *   if (tc.isError) return <ErrorDisplay error={tc.error} />
 *   if (!tc.data) return <NotFound />
 *
 *   return (
 *     <div>
 *       <Editor
 *         value={tc.data}
 *         onChange={(changes) => dispatch({ type: 'update', changes })}
 *       />
 *       {tc.isDirty && (
 *         <Button onClick={() => dispatch({ type: 'discard' })}>
 *           Discard Changes
 *         </Button>
 *       )}
 *       {tc.isNew && <Badge>New</Badge>}
 *     </div>
 *   )
 * }
 *
 * // Option 2: Efficient selectors (only subscribe to what you need)
 * function DirtyIndicator({ testcaseId }: { testcaseId: string }) {
 *   const isDirty = useAtomValue(testcase.selectors.isDirty(testcaseId))
 *   return isDirty ? <Badge>Modified</Badge> : null
 * }
 *
 * // Option 3: In-atom usage (for derived atoms)
 * const myDerivedAtom = atom(null, (get, set) => {
 *   set(testcase.actions.update, testcaseId, { name: 'Updated name' })
 *   set(testcase.actions.discard, testcaseId)
 * })
 * ```
 *
 * ## API Structure
 *
 * ```typescript
 * testcase.controller(id)           // Full state + dispatch (useAtom)
 * testcase.selectors.data(id)       // Entity with draft merged
 * testcase.selectors.serverData(id) // Raw server data
 * testcase.selectors.isDirty(id)    // Has unsaved changes
 * testcase.selectors.stateful(id)   // Data + loading/error states
 * testcase.selectors.cell({id,col}) // Fine-grained cell subscription
 * testcase.actions.update           // Update: set(actions.update, id, changes)
 * testcase.actions.discard          // Discard: set(actions.discard, id)
 * testcase.actions.add              // Create new: set(actions.add)
 * testcase.actions.append           // Batch create: set(actions.append, rows[])
 * testcase.actions.delete           // Delete: set(actions.delete, ids[])
 * ```
 *
 * ## When to Use Each
 *
 * **Use `controller` when:**
 * - You need both state and actions together
 * - Building forms or editors (like TestcaseEditDrawer)
 * - You want the simplest API
 *
 * **Use `selectors` when:**
 * - You only need one piece (e.g., just isDirty)
 * - Performance-critical scenarios (avoid extra subscriptions)
 * - Table cells (consider `testcaseCellAtomFamily` for even finer granularity)
 * - Building derived atoms
 *
 * **Use `actions` when:**
 * - Dispatching from other atoms (inside `set()`)
 * - Building derived write atoms
 *
 * ## Testcase-Specific Features
 *
 * Unlike traces, testcases have:
 * - Column change tracking (renames, adds, deletes)
 * - New entity support (locally created, not yet saved)
 * - Cell-level atoms for table performance (`testcaseCellAtomFamily`)
 *
 * For column operations, use the column atoms directly
 * (addColumnAtom, renameColumnAtom, deleteColumnAtom)
 */

import {createEntityController, type PathItem} from "../shared/createEntityController"

import {
    testcasePaginatedStore,
    testcasesRevisionIdAtom,
    testcasesSearchTermAtom,
    setDebouncedSearchTermAtom,
    testcasesFetchingAtom,
} from "./paginatedStore"
import type {FlattenedTestcase} from "./schema"
import {
    addTestcaseAtom,
    appendTestcasesAtom,
    createTestcasesAtom,
    deleteTestcasesAtom,
} from "./testcaseMutations"
import {
    discardDraftAtom,
    testcaseCellAtomFamily,
    testcaseEntityAtomFamily,
    testcaseIsDirtyAtomFamily,
    testcaseQueryAtomFamily,
    updateTestcaseAtom,
} from "./testcaseEntity"

// ============================================================================
// TYPES
// ============================================================================

export interface TestcaseColumn {
    key: string
    name: string
}

/**
 * Testcase entity API
 *
 * Provides controller, selectors, and actions for testcase entities.
 *
 * @example
 * ```typescript
 * // Full controller in components
 * const [tc, dispatch] = useAtom(testcase.controller(testcaseId))
 * dispatch({ type: 'update', changes: { name: 'Updated name' } })
 *
 * // Efficient selectors
 * const isDirty = useAtomValue(testcase.selectors.isDirty(testcaseId))
 * const data = useAtomValue(testcase.selectors.data(testcaseId))
 *
 * // In other atoms
 * set(testcase.actions.update, testcaseId, { name: 'New name' })
 * set(testcase.actions.discard, testcaseId)
 * ```
 */
// Create base controller
const baseController = createEntityController<FlattenedTestcase>({
    name: "testcase",

    // Entity data (server + draft + column changes merged)
    dataAtomFamily: testcaseEntityAtomFamily,

    // Query atom - single source of truth for server data
    queryAtomFamily: testcaseQueryAtomFamily,

    // Dirty state
    isDirtyAtomFamily: testcaseIsDirtyAtomFamily,

    // Actions
    updateAtom: updateTestcaseAtom,
    discardAtom: discardDraftAtom,

    // Testcases created locally have IDs starting with "new-" or "local-"
    isNewEntity: (id) => id.startsWith("new-") || id.startsWith("local-"),

    // Drill-in capability for path-based navigation and editing
    drillIn: {
        // Entire testcase entity is the root data (column-based structure)
        getRootData: (entity) => entity,

        // Convert updated data back to entity update
        // For testcases, extract only the top-level field that changed
        setRootData: (_entity, rootData, path) => {
            if (path.length === 0) return rootData
            const topLevelKey = path[0]
            return {
                [topLevelKey]: (rootData as Record<string, unknown>)[topLevelKey],
            } as Partial<FlattenedTestcase>
        },

        // Generate root items from columns
        // Columns are passed as second argument from the component
        getRootItems: (entity: FlattenedTestcase | null, ...args: unknown[]): PathItem[] => {
            const columns = args[0] as TestcaseColumn[] | undefined
            if (!entity || !columns) return []
            return columns.map((col) => ({
                key: col.key,
                name: col.name,
                // Use nullish coalescing to preserve falsy values like false and 0
                value: (entity as Record<string, unknown>)[col.key] ?? "",
                isColumn: true, // Prevents deletion of column
            }))
        },

        // Native mode - preserve objects/arrays as-is (not stringified)
        valueMode: "native",
    },
})

/**
 * Testcase entity API with extended selectors
 *
 * Extends the base controller with testcase-specific functionality:
 * - `selectors.cell({id, column})` - Fine-grained cell subscriptions for table performance
 *
 * @example
 * ```typescript
 * // Cell-level subscription (for table cells)
 * const cellValue = useAtomValue(testcase.selectors.cell({id: testcaseId, column: 'input'}))
 *
 * // Full controller
 * const [tc, dispatch] = useAtom(testcase.controller(testcaseId))
 * ```
 */
export const testcase = {
    ...baseController,
    selectors: {
        ...baseController.selectors,
        /**
         * Cell-level selector for fine-grained table subscriptions
         *
         * Uses selectAtom internally with custom equality checking.
         * Only re-renders when THIS specific cell value changes.
         * Supports dot notation for nested values (e.g., "event.type").
         *
         * @example
         * ```typescript
         * const value = useAtomValue(testcase.selectors.cell({id: 'tc-123', column: 'input'}))
         * // Or for nested paths:
         * const value = useAtomValue(testcase.selectors.cell({id: 'tc-123', column: 'event.type'}))
         * ```
         */
        cell: testcaseCellAtomFamily,
        /**
         * Atom that reads the current fetching state from the paginated store
         *
         * @example
         * ```typescript
         * const isFetching = useAtomValue(testcase.selectors.isFetching)
         * ```
         */
        isFetching: testcasesFetchingAtom,
    },
    actions: {
        ...baseController.actions,
        /**
         * Create a single new testcase with current columns initialized to empty strings
         *
         * @example
         * ```typescript
         * const addTestcase = useSetAtom(testcase.actions.add)
         * const result = addTestcase() // Returns { id: 'new-...', data: {...} }
         * ```
         */
        add: addTestcaseAtom,

        /**
         * Create multiple testcases with full control over options
         * - Custom ID prefix (e.g., 'local-' for drawer preview entities)
         * - Option to skip deduplication
         * - Option to skip column sync
         * - Returns created IDs for caller to track
         *
         * @example
         * ```typescript
         * const createTestcases = useSetAtom(testcase.actions.create)
         * const result = createTestcases({
         *   rows: [{input: 'hello', output: 'world'}],
         *   prefix: 'local-',
         *   skipDeduplication: true,
         * })
         * // result = { ids: ['local-...'], count: 1, skipped: 0 }
         * ```
         */
        create: createTestcasesAtom,

        /**
         * Batch append multiple testcases from data rows
         * - Adds new columns if they don't exist in current schema
         * - Deduplicates against existing testcases
         *
         * @deprecated Use `testcase.actions.create` for more control
         *
         * @example
         * ```typescript
         * const appendTestcases = useSetAtom(testcase.actions.append)
         * const addedCount = appendTestcases([{input: 'hello', output: 'world'}])
         * ```
         */
        append: appendTestcasesAtom,

        /**
         * Delete one or more testcases
         * - New entities (not yet saved): removed from tracking
         * - Existing entities: marked as deleted (soft delete)
         *
         * @example
         * ```typescript
         * const deleteTestcases = useSetAtom(testcase.actions.delete)
         * deleteTestcases(['tc-123', 'tc-456'])
         * ```
         */
        delete: deleteTestcasesAtom,
    },

    // ============================================================================
    // PAGINATED TABLE SUPPORT
    // ============================================================================

    /**
     * Paginated store for testcases table
     *
     * Provides cursor-based pagination with:
     * - Client-side rows (unsaved drafts prepended)
     * - Soft-delete filtering
     * - Debounced search
     * - Refresh trigger for cache invalidation
     *
     * @example
     * ```typescript
     * // In InfiniteVirtualTable
     * const {rows, loadNextPage} = useInfiniteTablePagination({
     *   store: testcase.paginated.store,
     *   scopeId: `testcases-${revisionId}`,
     *   pageSize: 50,
     * })
     *
     * // Refresh after mutations
     * const refresh = useSetAtom(testcase.paginated.refreshAtom)
     * refresh()
     * ```
     */
    paginated: testcasePaginatedStore,

    /**
     * Filter atoms for testcases table
     *
     * @example
     * ```typescript
     * // Get/set revision context
     * const [revisionId, setRevisionId] = useAtom(testcase.filters.revisionId)
     *
     * // Debounced search (300ms delay)
     * const setSearch = useSetAtom(testcase.filters.setSearchTerm)
     * setSearch('query')
     *
     * // Read immediate search value for UI
     * const searchTerm = useAtomValue(testcase.filters.searchTerm)
     * ```
     */
    filters: {
        /** Current revision ID for the testcases table */
        revisionId: testcasesRevisionIdAtom,
        /** Immediate search term (for UI display) */
        searchTerm: testcasesSearchTermAtom,
        /** Write-only atom to set search term with debouncing */
        setSearchTerm: setDebouncedSearchTermAtom,
    },
}

// Re-export types for convenience
export type {EntityAction, EntityControllerState} from "../shared/createEntityController"

// Type alias for testcase-specific usage
export type TestcaseAction = import("../shared/createEntityController").EntityAction<FlattenedTestcase>
export type TestcaseControllerState =
    import("../shared/createEntityController").EntityControllerState<FlattenedTestcase>
