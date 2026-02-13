/**
 * Testcase Molecule
 *
 * Unified API for testcase entity state management.
 * Uses createMolecule + extendMolecule + withController for consistency with other entities.
 *
 * NOTE: Column state is now managed at the REVISION level via revision.tableReducers.
 * Use revision.atoms.effectiveColumns(revisionId) for columns.
 * Use revision.tableReducers.addColumn/removeColumn/renameColumn for mutations.
 *
 * @example
 * ```typescript
 * import { testcaseMolecule } from '@agenta/entities/testcase'
 *
 * // Controller (state + dispatch)
 * const [state, dispatch] = useAtom(testcaseMolecule.controller(id))
 *
 * // Fine-grained selectors
 * const data = useAtomValue(testcaseMolecule.selectors.data(id))
 * const cell = useAtomValue(testcaseMolecule.atoms.cell({id, column}))
 *
 * // Imperative API
 * testcaseMolecule.set.update(id, { name: 'Updated' })
 * ```
 */

import {
    getValueAtPath as getValueAtPathUtil,
    setValueAtPath,
    getItemsAtPath,
    type DataPath,
} from "@agenta/shared/utils"
import {atom} from "jotai"
import {getDefaultStore} from "jotai/vanilla"
import {atomFamily} from "jotai-family"

import {createMolecule, extendMolecule, createControllerAtomFamily} from "../../shared"
import type {StoreOptions, PathItem, LoadableRow, LoadableColumn} from "../../shared"
import type {Column, Testcase} from "../core"
import {createLocalTestcase} from "../core"

import {testcasesRevisionIdAtom, initializeEmptyRevisionAtom} from "./paginatedStore"
import {
    // Query and entity atoms
    testcaseQueryAtomFamily,
    testcaseEntityAtomFamily,
    testcaseIsDirtyAtomFamily,
    testcaseCellAtomFamily,
    // Draft
    testcaseDraftAtomFamily,
    // ID tracking
    testcaseIdsAtom,
    newEntityIdsAtom,
    deletedEntityIdsAtom,
    addNewEntityIdAtom,
    markDeletedAtom,
    removeNewEntityIdAtom,
    // Context
    currentRevisionIdAtom,
    setCurrentRevisionIdAtom,
    // Mutations
    updateTestcaseAtom,
    discardDraftAtom,
    batchUpdateTestcasesSyncAtom,
    discardAllDraftsAtom,
    // Selection draft (for TestsetSelectionModal)
    testcaseSelectionDraftAtomFamily,
    setSelectionDraftAtom,
    commitSelectionDraftAtom,
    discardSelectionDraftAtom,
} from "./store"

// ============================================================================
// HELPER
// ============================================================================

function getStore(options?: StoreOptions) {
    return options?.store ?? getDefaultStore()
}

// ============================================================================
// LOCAL ENTITY FACTORY
// ============================================================================

// Note: Local testcase creation uses createLocalTestcase from ../core
// which accepts nested Testcase format with data in the `data` property
// (e.g., { data: { country: 'USA' } }). The factory validates input and
// generates a unique ID for local entities.

// ============================================================================
// DRILL-IN HELPERS
// ============================================================================

/**
 * Get value at path from testcase data.
 * Reads from testcase.data property.
 */
function getValueAtPath(testcase: Testcase | null, path: DataPath): unknown {
    if (!testcase) return undefined
    // Read from testcase.data (nested format)
    return getValueAtPathUtil(testcase.data ?? {}, path)
}

/**
 * Get root items for navigation.
 * Uses columns to determine what fields to show.
 * Reads from testcase.data property.
 */
function getRootItems(testcase: Testcase | null, columns?: unknown): PathItem[] {
    if (!testcase) return []

    const data = testcase.data ?? {}

    // If columns provided, use column keys as root items
    if (columns && Array.isArray(columns)) {
        return columns.map((col: Column) => {
            const value = data[col.key]
            return {
                key: col.key,
                name: col.label || col.key,
                value,
                expandable: value !== null && typeof value === "object",
            }
        })
    }

    // Fall back to object keys from testcase.data
    return getItemsAtPath(data, [])
}

/**
 * Convert path-based changes to draft format.
 * For testcases, changes go into testcase.data.
 */
function getChangesFromPath(
    testcase: Testcase | null,
    path: DataPath,
    value: unknown,
): {data: Record<string, unknown>} | null {
    if (!testcase || path.length === 0) return null

    // Build the update using setValueAtPath on the data property
    const currentData = testcase.data ?? {}
    const updatedData = setValueAtPath(currentData, path, value)

    // Return as data update
    return {data: updatedData as Record<string, unknown>}
}

// ============================================================================
// BASE MOLECULE
// ============================================================================

/**
 * Base molecule using createMolecule factory.
 * Uses Testcase (nested format) - cell values accessed via testcase.data[columnKey].
 *
 * Note: We use the existing atom families from store.ts which have the
 * complex logic for pending column changes and dirty detection.
 */
const baseMolecule = createMolecule<Testcase, Testcase>({
    name: "testcase",
    queryAtomFamily: testcaseQueryAtomFamily,
    draftAtomFamily: testcaseDraftAtomFamily,
    // Use custom isDirty since testcase has column-aware dirty detection
    // The store's isDirtyAtomFamily already handles this complexity
    isDirty: (_serverData, draft) => draft !== null,
    isNewEntity: (id) => id.startsWith("new-"),
})

// ============================================================================
// LOCAL COLUMNS STATE (REVISION-SCOPED)
// NOTE: Column operations (add/remove/rename) are now managed at revision level.
// See revision.tableReducers in @agenta/entities/testset
// ============================================================================

/**
 * Local columns per revision - for columns that don't exist on the server yet
 */
const localColumnsAtomFamily = atomFamily((_revisionId: string) => atom<Column[]>([]))

/**
 * Current local columns based on revision context
 */
const localColumnsAtom = atom(
    (get) => {
        const revisionId = get(currentRevisionIdAtom)
        if (!revisionId) return []
        return get(localColumnsAtomFamily(revisionId))
    },
    (get, set, columns: Column[]) => {
        const revisionId = get(currentRevisionIdAtom)
        if (!revisionId) return
        set(localColumnsAtomFamily(revisionId), columns)
    },
)

/**
 * Derive current columns from all testcases
 * This is used by components to know what columns exist
 */
const currentColumnsAtom = atom((get): Column[] => {
    const ids = get(testcaseIdsAtom)
    const newIds = get(newEntityIdsAtom)
    const revisionId = get(currentRevisionIdAtom)
    const allIds = [...ids, ...newIds]

    // Include local columns if we have a revision context
    const localCols = revisionId ? get(localColumnsAtomFamily(revisionId)) : []

    // Build column set from all entities
    const columnSet = new Map<string, Column>()

    // Add local columns first
    for (const col of localCols) {
        columnSet.set(col.key, col)
    }

    // Add columns from entities - columns come from the `data` property, not entity keys
    for (const id of allIds) {
        const entity = get(testcaseEntityAtomFamily(id))
        if (!entity) continue

        // Columns are derived from the `data` property of the testcase
        const data = (entity as {data?: Record<string, unknown>}).data
        if (!data || typeof data !== "object") continue

        for (const key of Object.keys(data)) {
            if (!columnSet.has(key)) {
                columnSet.set(key, {key, label: key})
            }
        }
    }

    return Array.from(columnSet.values())
})

// ============================================================================
// DERIVED ATOMS
// ============================================================================

/**
 * Check if any testcase has unsaved changes
 */
const hasAnyDirtyAtom = atom((get) => {
    const ids = get(testcaseIdsAtom)
    const deletedIds = get(deletedEntityIdsAtom)

    for (const id of ids) {
        if (deletedIds.has(id)) continue
        if (get(testcaseIsDirtyAtomFamily(id))) {
            return true
        }
    }
    return false
})

/**
 * Check if there are any unsaved testcase changes (data edits + new/deleted)
 * NOTE: Column changes are now tracked at revision level via revision.hasPendingChanges
 */
const hasUnsavedChangesAtom = atom((get) => {
    const newIds = get(newEntityIdsAtom)
    const deletedIds = get(deletedEntityIdsAtom)
    const hasTestcaseDirty = get(hasAnyDirtyAtom)

    return hasTestcaseDirty || newIds.length > 0 || deletedIds.size > 0
})

/**
 * Display row IDs - unified list of all testcase IDs for table display
 *
 * Returns new (local) IDs first, then server IDs (excluding deleted).
 * This is the single source of truth for what rows to display in the table.
 *
 * Entity Uniformity: Both local and server entities are accessed via the same API.
 */
const displayRowIdsAtom = atom((get) => {
    const newIds = get(newEntityIdsAtom)
    const serverIds = get(testcaseIdsAtom)
    const deletedIds = get(deletedEntityIdsAtom)

    // Filter out deleted server entities
    const activeServerIds = serverIds.filter((id) => !deletedIds.has(id))

    // New entities first (at top), then server entities
    return [...newIds, ...activeServerIds]
})

/**
 * Current selection for a revision (draft if exists, else displayRowIds)
 *
 * This provides a unified view of "what is currently selected":
 * - If a selection draft exists (user is editing), returns the draft
 * - Otherwise returns all displayRowIds (all currently loaded testcases)
 *
 * Used by TestsetSelectionModal to show the current selection state.
 */
const currentSelectionAtomFamily = atomFamily((revisionId: string) =>
    atom((get) => {
        const draft = get(testcaseSelectionDraftAtomFamily(revisionId))
        if (draft !== null) return [...draft]
        return get(displayRowIdsAtom)
    }),
)

/**
 * Initialize selection draft from current displayRowIds or provided IDs
 *
 * Called when opening the selection modal to populate the draft
 * with the current selection (all loaded testcases).
 *
 * @param revisionId - The revision ID to initialize draft for
 * @param initialIds - Optional array of IDs to use instead of displayRowIds.
 *                     Use this when the caller has a filtered view (e.g., loadable controller
 *                     filters out hidden testcases).
 */
const initSelectionDraftAtom = atom(null, (get, set, revisionId: string, initialIds?: string[]) => {
    const currentIds = initialIds ?? get(displayRowIdsAtom)
    set(setSelectionDraftAtom, revisionId, currentIds)
})

// ============================================================================
// LOADABLE CAPABILITY ATOMS
// ============================================================================

/**
 * Transform testcase entity to LoadableRow format.
 * Testcase is nested format - data comes from testcase.data.
 */
function testcaseToLoadableRow(entity: Testcase | null): LoadableRow {
    if (!entity) {
        return {id: "", data: {}}
    }

    // Data fields are already in testcase.data
    return {
        id: entity.id || "",
        data: entity.data ?? {},
    }
}

/**
 * Loadable rows atom family - returns LoadableRow[] for the current revision context.
 *
 * NOTE: This requires the revision context to be set via setRevisionContextAtom.
 * The revisionId parameter is used for cache keying and context verification.
 *
 * @param revisionId - The revision ID (used for cache keying)
 */
const loadableRowsAtomFamily = atomFamily((revisionId: string) =>
    atom((get): LoadableRow[] => {
        // Verify context matches
        const currentRevId = get(currentRevisionIdAtom)
        if (currentRevId !== revisionId) {
            // Context mismatch - return empty (caller should set context first)
            return []
        }

        const rowIds = get(displayRowIdsAtom)
        const rows: LoadableRow[] = []

        for (const id of rowIds) {
            const entity = get(testcaseEntityAtomFamily(id))
            rows.push(testcaseToLoadableRow(entity))
        }

        return rows
    }),
)

/**
 * Loadable columns atom family - returns LoadableColumn[] for the current revision context.
 *
 * @param revisionId - The revision ID (used for cache keying)
 */
const loadableColumnsAtomFamily = atomFamily((revisionId: string) =>
    atom((get): LoadableColumn[] => {
        // Verify context matches
        const currentRevId = get(currentRevisionIdAtom)
        if (currentRevId !== revisionId) {
            return []
        }

        const columns = get(currentColumnsAtom)
        return columns.map(
            (col): LoadableColumn => ({
                key: col.key,
                name: col.label || col.key,
                type: "string", // Default type, could be inferred from data
            }),
        )
    }),
)

/**
 * Loadable hasChanges atom family - returns whether the revision has unsaved changes.
 *
 * @param revisionId - The revision ID (used for cache keying)
 */
const loadableHasChangesAtomFamily = atomFamily((revisionId: string) =>
    atom((get): boolean => {
        // Verify context matches
        const currentRevId = get(currentRevisionIdAtom)
        if (currentRevId !== revisionId) {
            return false
        }

        return get(hasUnsavedChangesAtom)
    }),
)

// ============================================================================
// ACTION ATOMS
// ============================================================================

/**
 * Input type for creating new testcases.
 * Accepts either nested Testcase format or flat data that will be wrapped.
 */
type TestcaseCreateInput = Partial<Testcase> | {data?: Record<string, unknown>}

/**
 * Add a new testcase action.
 * Creates a validated local testcase.
 * @returns {id: string, data: Testcase} | null if validation fails
 */
const addTestcaseAtom = atom(null, (_get, set, initialData?: TestcaseCreateInput) => {
    // createLocalTestcase accepts nested Testcase format with data property
    const result = createLocalTestcase(initialData as Partial<Testcase>)

    if (result.success === false) {
        console.error("[testcase] Invalid data for new testcase:", result.errors)
        return null
    }

    const testcase = result.data

    // Add to new IDs tracking
    set(addNewEntityIdAtom, testcase.id)

    // Initialize draft with Testcase data
    set(testcaseDraftAtomFamily(testcase.id), testcase)

    return {id: testcase.id, data: testcase}
})

/**
 * Delete testcases action
 * Marks testcases for deletion (soft delete)
 * For new entities (local-* or new-*), removes them completely
 */
const deleteTestcasesAtom = atom(null, (_get, set, ids: string | string[]) => {
    const idsArray = Array.isArray(ids) ? ids : [ids]
    for (const id of idsArray) {
        // For new entities, remove them completely instead of soft delete
        if (id.startsWith("new-") || id.startsWith("local-")) {
            set(removeNewEntityIdAtom, id)
            set(testcaseDraftAtomFamily(id), null)
        } else {
            set(markDeletedAtom, id)
        }
    }
})

/**
 * Append multiple testcases action.
 * Creates multiple validated testcases from row data.
 * @returns Number of testcases successfully added
 */
const appendTestcasesAtom = atom(null, (_get, set, rows: Record<string, unknown>[]) => {
    let count = 0
    for (const row of rows) {
        // createLocalTestcase accepts nested Testcase format
        // Wrap the row data in `data` property if it's raw row data
        const input: Partial<Testcase> = row.data ? (row as Partial<Testcase>) : {data: row}
        const result = createLocalTestcase(input)

        if (result.success === false) {
            console.error("[testcase] Skipping invalid row:", result.errors)
            continue
        }

        const testcase = result.data

        // Add to new IDs tracking
        set(addNewEntityIdAtom, testcase.id)

        // Initialize draft with Testcase data
        set(testcaseDraftAtomFamily(testcase.id), testcase)

        count++
    }
    return count
})

// ============================================================================
// REVISION CONTEXT ACTION
// ============================================================================

/**
 * Set the revision context for testcase operations.
 * This sets both the context atom (for entity operations) and the paginated store's
 * revision ID (for data fetching).
 *
 * Use this instead of directly setting internal atoms.
 */
const setRevisionContextAtom = atom(null, (_get, set, revisionId: string | null) => {
    // Set the context atom for entity operations
    set(setCurrentRevisionIdAtom, revisionId)
    // Set the paginated store's revision ID for data fetching
    set(testcasesRevisionIdAtom, revisionId)
})

// ============================================================================
// CREATE ACTION (WITH OPTIONS)
// ============================================================================

interface CreateTestcasesOptions {
    /** Row data to create entities from */
    rows: Record<string, unknown>[]
    /** Skip deduplication check (default: false) */
    skipDeduplication?: boolean
    /** Skip column sync (default: false) */
    skipColumnSync?: boolean
    /** Testset ID to associate with */
    testsetId?: string
    /** ID prefix for local entities (default: "new-") */
    prefix?: string
}

/**
 * Create multiple validated testcases with options from row data.
 * @returns {ids: string[], count: number, errors: number}
 */
const createTestcasesAtom = atom(
    null,
    (
        _get,
        set,
        options: CreateTestcasesOptions,
    ): {ids: string[]; count: number; errors: number} => {
        const {rows} = options
        const ids: string[] = []
        let errors = 0

        for (const row of rows) {
            // createLocalTestcase accepts nested Testcase format
            // Wrap the row data in `data` property if it's raw row data
            const input: Partial<Testcase> = row.data ? (row as Partial<Testcase>) : {data: row}
            const result = createLocalTestcase(input)

            if (result.success === false) {
                console.error("[testcase] Skipping invalid row:", result.errors)
                errors++
                continue
            }

            const testcase = result.data

            // Add to new IDs tracking
            set(addNewEntityIdAtom, testcase.id)

            // Initialize draft with Testcase data
            set(testcaseDraftAtomFamily(testcase.id), testcase)

            ids.push(testcase.id)
        }

        return {ids, count: ids.length, errors}
    },
)

// ============================================================================
// EXTENDED MOLECULE
// ============================================================================

/**
 * Extend base molecule with testcase-specific atoms and reducers.
 */
const extendedMolecule = extendMolecule(baseMolecule, {
    atoms: {
        /** Cell value accessor for fine-grained table subscriptions */
        cell: testcaseCellAtomFamily,
        /** Server testcase IDs */
        ids: testcaseIdsAtom,
        /** New entity IDs (local only) */
        newIds: newEntityIdsAtom,
        /** Deleted entity IDs (pending save) */
        deletedIds: deletedEntityIdsAtom,
        /** Display row IDs - unified list (new first, then server, excluding deleted) */
        displayRowIds: displayRowIdsAtom,
        /** Current revision ID */
        revisionId: currentRevisionIdAtom,
        /** Has any dirty testcase */
        hasAnyDirty: hasAnyDirtyAtom,
        /** Has any unsaved changes */
        hasUnsavedChanges: hasUnsavedChangesAtom,
        /** Current columns */
        columns: currentColumnsAtom,
        /** Local columns per revision */
        localColumns: localColumnsAtom,
        /** Local columns family (per revision) */
        localColumnsFamily: localColumnsAtomFamily,
        /** Selection draft per revision (for TestsetSelectionModal) */
        selectionDraft: testcaseSelectionDraftAtomFamily,
        /** Current selection (draft if exists, else displayRowIds) */
        currentSelection: currentSelectionAtomFamily,
    },
    reducers: {
        /** Discard all drafts */
        discardAll: discardAllDraftsAtom,
        /** Batch update */
        batchUpdate: batchUpdateTestcasesSyncAtom,
        /** Add a new testcase - returns {id, data} */
        add: addTestcaseAtom,
        /** Delete testcases by ID(s) - soft delete for server entities, full remove for local */
        delete: deleteTestcasesAtom,
        /** Append multiple testcases from row data - returns count */
        append: appendTestcasesAtom,
        /** Create multiple testcases with options - returns {ids, count} */
        create: createTestcasesAtom,
        /** Initialize selection draft from current displayRowIds */
        initSelectionDraft: initSelectionDraftAtom,
        /** Set selection draft */
        setSelectionDraft: setSelectionDraftAtom,
        /** Commit selection draft to actual selection */
        commitSelectionDraft: commitSelectionDraftAtom,
        /** Discard selection draft */
        discardSelectionDraft: discardSelectionDraftAtom,
    },
    get: {
        /** Get cell value */
        cell: (id: string, column: string, options?: StoreOptions) =>
            getStore(options).get(testcaseCellAtomFamily({id, column})),
        /** Get server IDs */
        ids: (options?: StoreOptions) => getStore(options).get(testcaseIdsAtom),
        /** Get new IDs */
        newIds: (options?: StoreOptions) => getStore(options).get(newEntityIdsAtom),
        /** Get deleted IDs */
        deletedIds: (options?: StoreOptions) => getStore(options).get(deletedEntityIdsAtom),
        /** Get display row IDs (new first, then server, excluding deleted) */
        displayRowIds: (options?: StoreOptions) => getStore(options).get(displayRowIdsAtom),
        /** Check if has unsaved changes */
        hasUnsavedChanges: (options?: StoreOptions) => getStore(options).get(hasUnsavedChangesAtom),
        /** Get current columns */
        columns: (options?: StoreOptions) => getStore(options).get(currentColumnsAtom),
        /** Get local columns for revision */
        localColumns: (revisionId: string, options?: StoreOptions) =>
            getStore(options).get(localColumnsAtomFamily(revisionId)),
    },
    set: {
        /** Discard all drafts */
        discardAll: (options?: StoreOptions) => getStore(options).set(discardAllDraftsAtom),
        /** Batch update */
        batchUpdate: (
            updates: {id: string; updates: {data?: Record<string, unknown>}}[],
            options?: StoreOptions,
        ) => getStore(options).set(batchUpdateTestcasesSyncAtom, updates),
        /** Delete testcases */
        delete: (ids: string | string[], options?: StoreOptions) =>
            getStore(options).set(deleteTestcasesAtom, ids),
        /** Create testcases with options */
        create: (opts: CreateTestcasesOptions, options?: StoreOptions) =>
            getStore(options).set(createTestcasesAtom, opts),
        /** Set local columns for revision */
        localColumns: (revisionId: string, columns: Column[], options?: StoreOptions) =>
            getStore(options).set(localColumnsAtomFamily(revisionId), columns),
    },
})

// ============================================================================
// CONTROLLER
// ============================================================================

/**
 * Controller atom family using store's entity atom (with pending column changes applied)
 * and store's isDirty atom (with column-aware dirty detection).
 * Uses Testcase (nested format) - cell values accessed via testcase.data[columnKey].
 */
const testcaseControllerAtomFamily = createControllerAtomFamily<
    Testcase,
    {data?: Record<string, unknown>}
>({
    dataAtom: testcaseEntityAtomFamily,
    isDirtyAtom: testcaseIsDirtyAtomFamily,
    queryAtom: testcaseQueryAtomFamily,
    updateReducer: updateTestcaseAtom,
    discardReducer: discardDraftAtom,
    drillIn: {
        getChangesFromPath,
    },
})

// ============================================================================
// FINAL MOLECULE EXPORT
// ============================================================================

/**
 * Testcase molecule - unified API for testcase entity management
 *
 * ## Unified API
 *
 * The testcase molecule provides a unified API with these access patterns:
 *
 * ### Top-level (most common operations)
 * ```typescript
 * testcase.data(id)         // Reactive: merged entity data
 * testcase.query(id)        // Reactive: query state with loading/error
 * testcase.isDirty(id)      // Reactive: has unsaved changes
 * testcase.ids              // Reactive: server entity IDs
 * testcase.newIds           // Reactive: new entity IDs
 * testcase.deletedIds       // Reactive: soft-deleted entity IDs
 * ```
 *
 * ### Actions namespace (all write operations)
 * ```typescript
 * set(testcase.actions.update, id, changes)
 * set(testcase.actions.add, initialData)
 * set(testcase.actions.delete, ids)
 * ```
 *
 * ### Loadable capability (for unified data loading)
 * ```typescript
 * testcase.loadable.rows(revisionId)
 * testcase.loadable.columns(revisionId)
 * testcase.loadable.hasChanges(revisionId)
 * ```
 *
 * @example
 * ```typescript
 * import { testcase } from '@agenta/entities'
 *
 * // Reactive subscriptions (most common)
 * const data = useAtomValue(testcase.data(id))
 * const serverIds = useAtomValue(testcase.ids)
 * const newIds = useAtomValue(testcase.newIds)
 *
 * // Write operations
 * const addTestcase = useSetAtom(testcase.actions.add)
 * const {id} = addTestcase({input: '', expected: ''})
 *
 * // Imperative reads (in callbacks)
 * const data = testcase.get.data(id)
 * ```
 */
export const testcaseMolecule = {
    /** Entity name */
    name: "testcase" as const,

    // =========================================================================
    // TOP-LEVEL API (most common operations - flattened for ergonomics)
    // =========================================================================

    /**
     * Get merged entity data (server + draft with pending column changes).
     * Returns Testcase (nested format) - cell values accessed via testcase.data[columnKey].
     * @param id - Testcase ID
     * @returns Atom<Testcase | null>
     * @example const data = useAtomValue(testcase.data(id))
     */
    data: testcaseEntityAtomFamily,

    /**
     * Get query state with loading/error status.
     * Returns Testcase (nested format).
     * @param id - Testcase ID
     * @returns Atom<QueryState<Testcase>>
     * @example const {data, isPending, isError} = useAtomValue(testcase.query(id))
     */
    query: testcaseQueryAtomFamily,

    /**
     * Check if entity has unsaved changes (column-aware).
     * @param id - Testcase ID
     * @returns Atom<boolean>
     * @example const isDirty = useAtomValue(testcase.isDirty(id))
     */
    isDirty: testcaseIsDirtyAtomFamily,

    /**
     * Server entity IDs.
     * @example const serverIds = useAtomValue(testcase.ids)
     */
    ids: testcaseIdsAtom,

    /**
     * New (local) entity IDs.
     * @example const newIds = useAtomValue(testcase.newIds)
     */
    newIds: newEntityIdsAtom,

    /**
     * Soft-deleted entity IDs.
     * @example const deletedIds = useAtomValue(testcase.deletedIds)
     */
    deletedIds: deletedEntityIdsAtom,

    // Controller for EntityDrillInView compatibility
    controller: testcaseControllerAtomFamily,

    // =========================================================================
    // LOADABLE CAPABILITY
    // =========================================================================

    /**
     * Loadable capability - provides unified data loading interface.
     *
     * NOTE: These selectors require the revision context to be set first
     * via `testcase.actions.setRevisionContext(revisionId)`.
     *
     * @example
     * ```typescript
     * // Set context first
     * set(testcase.actions.setRevisionContext, revisionId)
     *
     * // Then read loadable data
     * const rows = useAtomValue(testcase.loadable.rows(revisionId))
     * const columns = useAtomValue(testcase.loadable.columns(revisionId))
     * const hasChanges = useAtomValue(testcase.loadable.hasChanges(revisionId))
     * ```
     */
    loadable: {
        /** Get all rows as LoadableRow[] for the revision */
        rows: loadableRowsAtomFamily,
        /** Get column definitions as LoadableColumn[] for the revision */
        columns: loadableColumnsAtomFamily,
        /** Check if the revision has unsaved changes */
        hasChanges: loadableHasChangesAtomFamily,
    },

    // =========================================================================
    // ATOMS namespace (additional/less common reactive atoms)
    // =========================================================================

    atoms: {
        ...extendedMolecule.atoms,
        /** Override data to use store's entity atom with pending column changes */
        data: testcaseEntityAtomFamily,
        /** Override isDirty to use store's column-aware dirty detection */
        isDirty: testcaseIsDirtyAtomFamily,
        /** Cell value accessor for fine-grained table subscriptions */
        cell: testcaseCellAtomFamily,
        /** Draft state */
        draft: testcaseDraftAtomFamily,
    },

    // =========================================================================
    // ACTIONS namespace (all write operations)
    // =========================================================================

    /**
     * Action atoms for mutations.
     * Use with `useSetAtom` in components or `set()` in atom compositions.
     */
    actions: {
        /** Update testcase draft */
        update: updateTestcaseAtom,
        /** Discard testcase draft */
        discard: discardDraftAtom,
        /** Discard all drafts */
        discardAll: discardAllDraftsAtom,
        /** Add a new testcase - returns {id, data} */
        add: addTestcaseAtom,
        /** Delete testcases by ID(s) - soft delete for server entities, full remove for local */
        delete: deleteTestcasesAtom,
        /** Append multiple testcases from row data - returns count */
        append: appendTestcasesAtom,
        /** Create multiple testcases with options - returns {ids, count} */
        create: createTestcasesAtom,
        /** Batch update multiple testcases */
        batchUpdate: batchUpdateTestcasesSyncAtom,
        /** Set revision context for testcase operations (sets both context and paginated store) */
        setRevisionContext: setRevisionContextAtom,
        /** Initialize selection draft from current displayRowIds */
        initSelectionDraft: initSelectionDraftAtom,
        /** Set selection draft */
        setSelectionDraft: setSelectionDraftAtom,
        /** Commit selection draft to actual selection */
        commitSelectionDraft: commitSelectionDraftAtom,
        /** Discard selection draft */
        discardSelectionDraft: discardSelectionDraftAtom,
        /** Initialize empty revision with default testcase (for "create from scratch" flow) */
        initializeEmptyRevision: initializeEmptyRevisionAtom,
    },

    /**
     * Selectors - DEPRECATED: Use top-level aliases instead
     * @deprecated Use testcase.data(id), testcase.query(id), testcase.isDirty(id)
     */
    selectors: {
        /** @deprecated Use testcase.data(id) */
        data: testcaseEntityAtomFamily,
        /** Server data only */
        serverData: baseMolecule.atoms.serverData,
        /** @deprecated Use testcase.atoms.draft(id) */
        draft: testcaseDraftAtomFamily,
        /** @deprecated Use testcase.isDirty(id) */
        isDirty: testcaseIsDirtyAtomFamily,
        /** @deprecated Use testcase.query(id) */
        query: testcaseQueryAtomFamily,
        /** Current columns derived from all entities */
        columns: currentColumnsAtom,
        /** New entity IDs (local only) */
        newEntityIds: newEntityIdsAtom,
        /** Local columns per revision (writable) */
        localColumnsFamily: localColumnsAtomFamily,
        /** Selection draft per revision (for TestsetSelectionModal) */
        selectionDraft: testcaseSelectionDraftAtomFamily,
        /** Current selection (draft if exists, else displayRowIds) */
        currentSelection: currentSelectionAtomFamily,
    },

    /**
     * Reducers - DEPRECATED: Use actions namespace instead
     * @deprecated Use testcase.actions.*
     */
    reducers: {
        ...extendedMolecule.reducers,
        /** @deprecated Use testcase.actions.update */
        update: updateTestcaseAtom,
        /** @deprecated Use testcase.actions.discard */
        discard: discardDraftAtom,
    },

    // DrillIn utilities for path-based navigation and editing
    drillIn: {
        getValueAtPath,
        getRootItems,
        getChangesFromPath,
        valueMode: "native" as const,
        /**
         * Extract root data for navigation.
         * For testcases, returns the .data property (nested format).
         */
        getRootData: (entity: Testcase | null) => entity?.data ?? null,
        /**
         * Convert path-based changes back to entity draft format.
         * For testcases, changes go into testcase.data.
         */
        getChangesFromRoot: (
            entity: Testcase | null,
            _rootData: unknown,
            path: DataPath,
            value: unknown,
        ): {data: Record<string, unknown>} | null => {
            return getChangesFromPath(entity, path, value)
        },
    },

    // Imperative API
    get: extendedMolecule.get,
    set: extendedMolecule.set,

    // Lifecycle and cleanup from base molecule
    lifecycle: baseMolecule.lifecycle,
    cleanup: baseMolecule.cleanup,

    // useController hook from base molecule
    useController: baseMolecule.useController,
}

// ============================================================================
// TYPE EXPORTS
// ============================================================================

export type TestcaseMolecule = typeof testcaseMolecule
export type {CreateTestcasesOptions}
