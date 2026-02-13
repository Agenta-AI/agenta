/**
 * Testset Molecule
 *
 * Provides unified state management for testset entities using the molecule pattern.
 *
 * ## Usage
 *
 * ```typescript
 * import { testsetMolecule } from '@agenta/entities/testset'
 *
 * // In components - use the React hook
 * const [state, dispatch] = testsetMolecule.useController(testsetId)
 * dispatch.update({ name: 'New Name', description: 'Updated' })
 *
 * // In atoms - use atoms directly
 * const dataAtom = testsetMolecule.atoms.data(testsetId)
 * const isDirtyAtom = testsetMolecule.atoms.isDirty(testsetId)
 *
 * // List query
 * const testsetsQuery = testsetMolecule.atoms.list(null) // null = no search
 *
 * // Paginated store for InfiniteVirtualTable
 * const table = useTableManager({
 *   datasetStore: testsetMolecule.paginated.store,
 *   scopeId: 'testsets-page',
 *   pageSize: 50,
 * })
 *
 * // Filter atoms
 * const searchTerm = useAtomValue(testsetMolecule.filters.searchTerm)
 * const exportFormat = useAtomValue(testsetMolecule.filters.exportFormat)
 *
 * // Imperatively (in callbacks)
 * const data = testsetMolecule.get.data(testsetId)
 * testsetMolecule.set.update(testsetId, { name: 'New Name' })
 * ```
 */

import {
    getValueAtPath as getValueAtPathUtil,
    setValueAtPath,
    getItemsAtPath,
    type DataPath,
} from "@agenta/shared/utils"
import {atom, getDefaultStore} from "jotai"

import {
    createMolecule,
    extendMolecule,
    createControllerAtomFamily,
    createListExtension,
} from "../../shared"
import type {AtomFamily, QueryState, PathItem} from "../../shared"
import {testcaseMolecule} from "../../testcase/state/molecule"
import {fetchLatestRevision} from "../api"
import {createTestset} from "../api/mutations"
import {isNewTestsetId, type Testset, type Revision, type RevisionListItem} from "../core"

import {
    saveNewTestsetAtom,
    saveReducer,
    changesSummaryAtom,
    deleteTestsetsReducer,
} from "./mutations"
import {testsetPaginatedStore, testsetFilters, testsetsPaginatedMetaAtom} from "./paginatedStore"
import {
    testsetQueryAtomFamily,
    testsetDraftAtomFamily,
    testsetsListQueryAtomFamily,
    variantQueryAtomFamily,
    invalidateTestsetsListCache,
    invalidateTestsetCache,
    // Latest revision
    latestRevisionQueryAtomFamily,
    latestRevisionStatefulAtomFamily,
    requestLatestRevisionAtom,
    // Revisions list
    revisionsListQueryAtomFamily,
    enableRevisionsListQueryAtom,
} from "./store"

// ============================================================================
// LIST EXTENSIONS (using createListExtension factory)
// ============================================================================

/**
 * Revisions list extension - provides standard list API for testset revisions
 */
const revisionsListExtension = createListExtension<
    RevisionListItem,
    {testsetId: string; projectId: string}
>({
    name: "revisionsList",
    queryAtomFamily: revisionsListQueryAtomFamily,
    enableAtom: enableRevisionsListQueryAtom,
})

// ============================================================================
// NULL-SAFE QUERY UTILITIES
// ============================================================================

/**
 * Null query result for use when no ID is provided.
 * Prevents unnecessary network requests for empty/null IDs.
 */
const nullQueryResultAtom = atom<QueryState<Testset>>(() => ({
    data: null,
    isPending: false,
    isError: false,
    error: null,
}))

/**
 * Null data atom for use when no ID is provided.
 */
const nullDataAtom = atom<Testset | null>(() => null)

// ============================================================================
// BASE MOLECULE
// ============================================================================

/**
 * Base testset molecule with core state management
 */
const baseTestsetMolecule = createMolecule<Testset, Partial<Testset>>({
    name: "testset",
    // Type assertion: jotai-family's atomFamily type is structurally compatible but needs cast
    queryAtomFamily: testsetQueryAtomFamily as AtomFamily<QueryState<Testset>>,
    draftAtomFamily: testsetDraftAtomFamily,
    // Simple dirty check - draft exists means dirty
    isDirty: (_serverData, draft) => draft !== null,
    // New testsets use the "new" ID
    isNewEntity: (id) => isNewTestsetId(id),
})

// ============================================================================
// EXTENDED MOLECULE
// ============================================================================

/**
 * Extended testset molecule with list query, variants, pagination, and filters
 */
const extendedMolecule = extendMolecule(baseTestsetMolecule, {
    atoms: {
        /** Testsets list query (param: search query or null) */
        list: testsetsListQueryAtomFamily as AtomFamily<unknown>,
        /** Variant query (for name/description) */
        variant: variantQueryAtomFamily as AtomFamily<unknown>,
    },
})

// ============================================================================
// DRILL-IN HELPERS
// ============================================================================

/**
 * Get value at path from testset data
 */
function getValueAtPath(data: Testset | null, path: DataPath): unknown {
    if (!data) return undefined
    return getValueAtPathUtil(data, path)
}

/**
 * Get root items for navigation.
 * Returns the top-level testset fields.
 */
function getRootItems(data: Testset | null): PathItem[] {
    if (!data) return []
    return getItemsAtPath(data, [])
}

/**
 * Convert path-based changes to draft format.
 * For testsets, the entire entity is draftable.
 */
function getChangesFromPath(
    data: Testset | null,
    path: DataPath,
    value: unknown,
): Partial<Testset> | null {
    if (!data || path.length === 0) return null

    // Build the update using setValueAtPath
    const updated = setValueAtPath(data, path, value)

    // Extract the changes (top-level key that changed)
    const topKey = path[0]
    if (typeof topKey === "string") {
        return {
            [topKey]: (updated as Record<string, unknown>)[topKey],
        } as Partial<Testset>
    }

    return null
}

// ============================================================================
// CONTROLLER
// ============================================================================

/**
 * Controller atom family for state + dispatch pattern.
 * Provides unified read/write interface for EntityDrillInView compatibility.
 */
const testsetControllerAtomFamily = createControllerAtomFamily<Testset, Partial<Testset>>({
    dataAtom: extendedMolecule.atoms.data,
    isDirtyAtom: extendedMolecule.atoms.isDirty,
    queryAtom: extendedMolecule.atoms.query,
    updateReducer: extendedMolecule.reducers.update,
    discardReducer: extendedMolecule.reducers.discard,
    drillIn: {
        getChangesFromPath,
    },
})

/**
 * Full testset molecule with paginated store and filters
 *
 * ## Unified API
 *
 * The testset molecule provides a unified API with these access patterns:
 *
 * ### Top-level (most common operations)
 * ```typescript
 * testset.data(id)         // Reactive: merged entity data
 * testset.query(id)        // Reactive: query state with loading/error
 * testset.isDirty(id)      // Reactive: has unsaved changes
 * testset.changesSummary   // Reactive: counts of changes
 * ```
 *
 * ### Actions namespace (all write operations)
 * ```typescript
 * set(testset.actions.update, id, changes)
 * set(testset.actions.save, params)
 * set(testset.actions.delete, ids)
 * ```
 *
 * ### Get namespace (imperative reads)
 * ```typescript
 * testset.get.data(id)
 * testset.get.isDirty(id)
 * ```
 *
 * @example
 * ```typescript
 * import { testset } from '@agenta/entities'
 *
 * // Reactive subscriptions (most common)
 * const data = useAtomValue(testset.data(id))
 * const {isPending, isError} = useAtomValue(testset.query(id))
 * const summary = useAtomValue(testset.changesSummary)
 *
 * // Write operations
 * const save = useSetAtom(testset.actions.save)
 * await save({ projectId, revisionId })
 *
 * // Imperative reads (in callbacks)
 * const data = testset.get.data(id)
 * ```
 */
export const testsetMolecule = {
    ...extendedMolecule,

    // =========================================================================
    // TOP-LEVEL API (most common operations - flattened for ergonomics)
    // =========================================================================

    /**
     * Get merged entity data (server + draft).
     * @param id - Testset ID
     * @returns Atom<Testset | null>
     * @example const data = useAtomValue(testset.data(id))
     */
    data: extendedMolecule.atoms.data,

    /**
     * Get query state with loading/error status.
     * @param id - Testset ID
     * @returns Atom<QueryState<Testset>>
     * @example const {data, isPending, isError} = useAtomValue(testset.query(id))
     */
    query: testsetQueryAtomFamily as AtomFamily<QueryState<Testset>>,

    /**
     * Check if entity has unsaved changes.
     * @param id - Testset ID
     * @returns Atom<boolean>
     * @example const isDirty = useAtomValue(testset.isDirty(id))
     */
    isDirty: extendedMolecule.atoms.isDirty,

    /**
     * Null-safe query selector. Returns null query result when id is null/undefined.
     * Prevents unnecessary network requests for empty IDs.
     * @param id - Testset ID (can be null/undefined)
     * @returns Atom<QueryState<Testset>>
     * @example const query = useAtomValue(testset.queryOptional(id))
     */
    queryOptional: (id: string | null | undefined) =>
        id ? (testsetQueryAtomFamily(id) as typeof nullQueryResultAtom) : nullQueryResultAtom,

    /**
     * Null-safe data selector. Returns null when id is null/undefined.
     * @param id - Testset ID (can be null/undefined)
     * @returns Atom<Testset | null>
     * @example const data = useAtomValue(testset.dataOptional(id))
     */
    dataOptional: (id: string | null | undefined) =>
        id ? extendedMolecule.atoms.data(id) : nullDataAtom,

    /**
     * Changes summary - counts of new/updated/deleted testcases and column operations.
     * @example const summary = useAtomValue(testset.changesSummary)
     */
    changesSummary: changesSummaryAtom,

    /**
     * Controller atom family for state + dispatch pattern.
     * @example const [state, dispatch] = useAtom(testset.controller(id))
     */
    controller: testsetControllerAtomFamily,

    // =========================================================================
    // ATOMS namespace (additional/less common reactive atoms)
    // =========================================================================

    atoms: {
        ...extendedMolecule.atoms,
        /** Changes summary (also available at top level) */
        changesSummary: changesSummaryAtom,
    },

    // =========================================================================
    // ACTIONS namespace (all write operations)
    // =========================================================================

    /**
     * Action atoms for mutations.
     * Use with `useSetAtom` in components or `set()` in atom compositions.
     *
     * @example
     * ```typescript
     * // In components
     * const save = useSetAtom(testset.actions.save)
     * await save({ projectId, revisionId })
     *
     * // In atom compositions
     * const myAtom = atom(null, async (get, set) => {
     *   await set(testset.actions.save, { projectId, revisionId })
     * })
     * ```
     */
    actions: {
        /** Update testset draft */
        update: extendedMolecule.reducers.update,
        /** Discard testset draft */
        discard: extendedMolecule.reducers.discard,
        /**
         * Save testset changes (handles both new and existing testsets)
         * @param params - { projectId, revisionId?, testsetName?, commitMessage? }
         * @returns Promise<string | null> - New revision ID on success
         */
        save: saveReducer,
        /**
         * Delete (archive) testsets by IDs
         * @param ids - Array of testset IDs to delete
         */
        delete: deleteTestsetsReducer,
    },

    /**
     * Selectors - DEPRECATED: Use top-level aliases instead
     * @deprecated Use testset.data(id), testset.query(id), testset.isDirty(id)
     */
    selectors: {
        /** @deprecated Use testset.query(id) */
        query: testsetQueryAtomFamily as AtomFamily<QueryState<Testset>>,
        /**
         * Null-safe query selector. Returns null query result when id is null/undefined.
         * Prevents unnecessary network requests for empty IDs.
         * @example const query = useAtomValue(testset.selectors.queryOptional(id))
         */
        queryOptional: (id: string | null | undefined) =>
            // Cast needed: return type must match nullQueryResultAtom for union compatibility
            id ? (testsetQueryAtomFamily(id) as typeof nullQueryResultAtom) : nullQueryResultAtom,
        /** @deprecated Use testset.data(id) */
        data: extendedMolecule.atoms.data,
        /**
         * Null-safe data selector. Returns null when id is null/undefined.
         * @example const data = useAtomValue(testset.selectors.dataOptional(id))
         */
        dataOptional: (id: string | null | undefined) =>
            id ? extendedMolecule.atoms.data(id) : nullDataAtom,
        /** Raw server data (without draft) */
        serverData: extendedMolecule.atoms.serverData,
        /** @deprecated Use testset.atoms.draft(id) */
        draft: extendedMolecule.atoms.draft,
        /** @deprecated Use testset.isDirty(id) */
        isDirty: extendedMolecule.atoms.isDirty,
    },

    /**
     * DrillIn utilities for path-based navigation and editing.
     * Compatible with EntityDrillInView.
     */
    drillIn: {
        getValueAtPath,
        getRootItems,
        valueMode: "native" as const,
    },

    /**
     * Paginated store for InfiniteVirtualTable integration.
     *
     * @example
     * ```typescript
     * // With useTableManager
     * const table = useTableManager({
     *   datasetStore: testsetMolecule.paginated.store,
     *   scopeId: 'testsets-page',
     *   pageSize: 50,
     * })
     *
     * // Refresh data
     * const refresh = useSetAtom(testsetMolecule.paginated.refreshAtom)
     * refresh()
     * ```
     */
    paginated: {
        store: testsetPaginatedStore.store,
        refreshAtom: testsetPaginatedStore.refreshAtom,
        metaAtom: testsetsPaginatedMetaAtom,
        controller: testsetPaginatedStore.controller,
        selectors: testsetPaginatedStore.selectors,
        actions: testsetPaginatedStore.actions,
    },

    /**
     * Filter atoms for testsets queries.
     *
     * @example
     * ```typescript
     * // Read/write search term
     * const [searchTerm, setSearchTerm] = useAtom(testsetMolecule.filters.searchTerm)
     *
     * // Read export format preference (persisted)
     * const exportFormat = useAtomValue(testsetMolecule.filters.exportFormat)
     * ```
     */
    filters: testsetFilters,

    /**
     * Cache invalidation functions.
     *
     * @example
     * ```typescript
     * // Invalidate testsets list cache (e.g., after creating a testset)
     * testsetMolecule.invalidate.list()
     *
     * // Invalidate a specific testset
     * testsetMolecule.invalidate.detail(testsetId)
     * ```
     */
    invalidate: {
        /** Invalidate the testsets list cache */
        list: invalidateTestsetsListCache,
        /** Invalidate a specific testset's cache */
        detail: invalidateTestsetCache,
    },

    /**
     * Latest revision API for a testset.
     *
     * Provides optimized access to the latest revision of a testset using
     * batched fetching for performance (multiple requests are combined).
     *
     * @example
     * ```typescript
     * // In components - use selectors with hooks
     * const latestRevision = useAtomValue(testsetMolecule.latestRevision.selectors.data(testsetId))
     * const {data, isPending} = useAtomValue(testsetMolecule.latestRevision.selectors.stateful(testsetId))
     *
     * // Request latest revision (triggers fetch)
     * const request = useSetAtom(testsetMolecule.latestRevision.request)
     * request({testsetId, projectId})
     *
     * // Imperatively get cached data
     * const data = testsetMolecule.latestRevision.get(testsetId)
     * ```
     */
    latestRevision: {
        /**
         * Selectors for latest revision data
         */
        selectors: {
            /** Query atom - returns Revision | null */
            data: latestRevisionQueryAtomFamily as (
                testsetId: string,
            ) => ReturnType<typeof latestRevisionQueryAtomFamily>,
            /** Stateful atom - returns { data: Revision | null, isPending: boolean } */
            stateful: latestRevisionStatefulAtomFamily as (
                testsetId: string,
            ) => ReturnType<typeof latestRevisionStatefulAtomFamily>,
        },
        /**
         * Request atom to trigger fetching latest revision
         * @param params - { testsetId: string, projectId: string }
         */
        request: requestLatestRevisionAtom,
        /**
         * Imperatively get the latest revision data from cache
         * @param testsetId - The testset ID
         * @returns Revision | null
         */
        get: (testsetId: string): Revision | null => {
            const store = getDefaultStore()
            const queryResult = store.get(latestRevisionQueryAtomFamily(testsetId))
            return queryResult?.data ?? null
        },
        /**
         * Fetch the latest revision directly (bypasses cache, for imperative use)
         * @param testsetId - The testset ID
         * @param projectId - The project ID
         * @returns Promise<Revision | null>
         */
        fetch: async (testsetId: string, projectId: string): Promise<Revision | null> => {
            return fetchLatestRevision({testsetId, projectId})
        },
    },

    /**
     * Revisions list API for a testset.
     *
     * Provides access to all revisions of a testset (for expanding rows, revision history, etc.)
     * Uses createListExtension factory for standardized list API.
     *
     * @example
     * ```typescript
     * // In components - use atoms with hooks for reactive data
     * const revisions = useAtomValue(testsetMolecule.revisionsList.atoms.data(testsetId))
     *
     * // Request revisions list (triggers fetch)
     * const request = useSetAtom(testsetMolecule.revisionsList.reducers.request)
     * request({testsetId, projectId})
     *
     * // Imperatively get cached data
     * const revisions = testsetMolecule.revisionsList.get(testsetId)
     * ```
     */
    revisionsList: {
        /** Atoms for reactive subscriptions */
        atoms: revisionsListExtension.atoms.revisionsList,
        /** Reducers for triggering actions */
        reducers: revisionsListExtension.reducers.revisionsList,
        /** Imperative getter */
        get: revisionsListExtension.get.revisionsList,
    },

    /**
     * Unified save API for testsets.
     *
     * Handles new testset creation with two modes:
     * 1. Entity mode: Reads testcase data from entity atoms (for TestcasesTableNew flow)
     * 2. Direct mode: Accepts testcase data directly via params (for LoadTestsetModal, AddToTestsetDrawer)
     *
     * @example
     * ```typescript
     * // Mode 1: Entity mode - reads from testcase entity atoms
     * const newId = testsetMolecule.set.create({ name: 'My Testset' })
     * // ... user adds testcases via entity atoms ...
     * const result = await save({ testsetId: newId, projectId: 'proj-456' })
     *
     * // Mode 2: Direct mode - pass testcase data directly
     * const newId = testsetMolecule.set.create({ name: 'My Testset' })
     * const result = await save({
     *   testsetId: newId,
     *   projectId: 'proj-456',
     *   testcases: [{col1: 'val1'}, {col1: 'val2'}],
     *   commitMessage: 'Initial commit'
     * })
     * ```
     */
    save: {
        /**
         * Unified save reducer for new testsets
         *
         * @param testsetId - The local testset ID (from molecule.set.create())
         * @param projectId - The project ID
         * @param testcases - Optional: testcase data to save directly (skips entity atoms)
         * @param commitMessage - Optional: commit message
         */
        reducer: atom(
            null,
            async (
                get,
                set,
                params: {
                    testsetId: string
                    projectId: string
                    /** Optional: testcase data to save directly (skips reading from entity atoms) */
                    testcases?: Record<string, unknown>[]
                    commitMessage?: string
                },
            ): Promise<{
                success: boolean
                revisionId?: string
                testsetId?: string
                testcases?: Record<string, unknown>[]
                error?: Error
            }> => {
                const {testsetId, projectId, testcases: directTestcases, commitMessage} = params

                if (!testsetId || !projectId) {
                    return {success: false, error: new Error("Missing testsetId or projectId")}
                }

                const isNew = isNewTestsetId(testsetId)

                if (!isNew) {
                    // For existing testsets, use saveTestsetAtom from mutations
                    return {
                        success: false,
                        error: new Error(
                            "Use saveTestsetAtom from mutations for existing testsets (requires revision context)",
                        ),
                    }
                }

                // Get testset name from draft
                const draft = get(testsetDraftAtomFamily(testsetId))
                const testsetName = (draft?.name as string) ?? ""

                if (!testsetName.trim()) {
                    return {success: false, error: new Error("Testset name is required")}
                }

                // If testcases provided directly, use them; otherwise use saveNewTestsetAtom
                if (directTestcases !== undefined) {
                    // Direct mode: save with provided testcase data
                    try {
                        const response = await createTestset({
                            projectId,
                            name: testsetName,
                            testcases: directTestcases,
                            commitMessage,
                        })

                        if (response?.revisionId) {
                            // Clear the draft after successful save
                            set(testsetDraftAtomFamily(testsetId), null)
                            // Invalidate list cache
                            invalidateTestsetsListCache()

                            return {
                                success: true,
                                revisionId: response.revisionId,
                                testsetId: response.testset?.id,
                                testcases: directTestcases,
                            }
                        }

                        return {
                            success: false,
                            error: new Error("No revision ID returned from API"),
                        }
                    } catch (error) {
                        return {success: false, error: error as Error}
                    }
                }

                // Entity mode: use saveNewTestsetAtom which reads from entity atoms
                const result = await set(saveNewTestsetAtom, {projectId, testsetName})

                if (result.success && result.revisionId) {
                    // Clear the draft after successful save
                    set(testsetDraftAtomFamily(testsetId), null)
                    // Invalidate list cache
                    invalidateTestsetsListCache()
                }

                return result
            },
        ),
    },

    /**
     * Create a new local testset with an initial testcase.
     *
     * Creates the testset entity and an initial testcase with default properties.
     * Columns are derived from testcase properties - this is the correct mental model.
     *
     * @example
     * ```typescript
     * const newTestsetId = testsetMolecule.createWithTestcases({
     *   name: 'My Testset',
     *   initialTestcase: {input: '', correct_answer: ''}, // optional, defaults to this
     * })
     * ```
     */
    createWithTestcases: (
        params: {
            name: string
            description?: string
            /** Initial testcase data (default: {input: '', correct_answer: ''}) */
            initialTestcase?: Record<string, unknown>
        },
        options?: {store?: ReturnType<typeof getDefaultStore>},
    ): string => {
        const store = options?.store ?? getDefaultStore()
        const {name, description, initialTestcase = {input: "", correct_answer: ""}} = params

        // 1. Create the testset draft
        const testsetId = extendedMolecule.set.create({name, description}, {store})

        // 2. Create an initial testcase with default properties
        // Columns are derived from testcase properties - not set separately
        // Note: testcase schema expects properties inside `data` field
        const result = store.set(testcaseMolecule.actions.add, {data: initialTestcase})
        console.log("[createWithTestcases] testsetId:", testsetId, "testcase result:", result)

        return testsetId
    },
}

// ============================================================================
// TYPES
// ============================================================================

export type TestsetMolecule = typeof testsetMolecule

// ============================================================================
// CACHE INVALIDATION
// ============================================================================

/**
 * Invalidate testsets list cache
 */
export {invalidateTestsetsListCache}

/**
 * Invalidate a specific testset's cache
 */
export {invalidateTestsetCache}
