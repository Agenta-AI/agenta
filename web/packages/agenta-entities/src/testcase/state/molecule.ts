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

import {atom} from "jotai"
import {getDefaultStore} from "jotai/vanilla"
import {atomFamily} from "jotai-family"

import {
    createMolecule,
    extendMolecule,
    createControllerAtomFamily,
    createLocalEntityFactory,
} from "../../shared"
import type {StoreOptions, PathItem} from "../../shared"
import {
    getValueAtPath as getValueAtPathUtil,
    setValueAtPath,
    getItemsAtPath,
    type DataPath,
} from "../../ui"
import type {Column, FlattenedTestcase} from "../core"
import {testcaseSchemas} from "../core"

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
    // Mutations
    updateTestcaseAtom,
    discardDraftAtom,
    batchUpdateTestcasesSyncAtom,
    discardAllDraftsAtom,
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

/**
 * Factory for creating validated local testcase entities.
 *
 * Uses testcaseSchemas.local which:
 * - Generates a unique ID if not provided
 * - Applies default values for data, flags, tags, meta
 * - Validates against the testcase schema
 *
 * @example
 * ```typescript
 * const result = createTestcase({ country: 'USA', value: 123 })
 * if (result.success) {
 *   console.log(result.data) // Full testcase with ID and defaults
 * } else {
 *   console.error(result.errors) // Validation errors
 * }
 * ```
 */
const createTestcase = createLocalEntityFactory(testcaseSchemas.local)

// ============================================================================
// DRILL-IN HELPERS
// ============================================================================

/**
 * Get value at path from testcase data
 */
function getValueAtPath(data: FlattenedTestcase | null, path: DataPath): unknown {
    if (!data) return undefined
    return getValueAtPathUtil(data, path)
}

/**
 * Get root items for navigation.
 * Uses columns to determine what fields to show.
 */
function getRootItems(data: FlattenedTestcase | null, columns?: unknown): PathItem[] {
    if (!data) return []

    // If columns provided, use column keys as root items
    if (columns && Array.isArray(columns)) {
        return columns.map((col: Column) => {
            const value = (data as Record<string, unknown>)[col.key]
            return {
                key: col.key,
                name: col.label || col.key,
                value,
                expandable: value !== null && typeof value === "object",
            }
        })
    }

    // Fall back to object keys
    return getItemsAtPath(data, [])
}

/**
 * Convert path-based changes to draft format.
 * For testcases, the entire entity is draftable.
 */
function getChangesFromPath(
    data: FlattenedTestcase | null,
    path: DataPath,
    value: unknown,
): Partial<FlattenedTestcase> | null {
    if (!data || path.length === 0) return null

    // Build the update using setValueAtPath
    const updated = setValueAtPath(data, path, value)

    // Extract the changes (top-level key that changed)
    const topKey = path[0]
    if (typeof topKey === "string") {
        return {
            [topKey]: (updated as Record<string, unknown>)[topKey],
        } as Partial<FlattenedTestcase>
    }

    return null
}

// ============================================================================
// BASE MOLECULE
// ============================================================================

/**
 * Base molecule using createMolecule factory.
 *
 * Note: We use the existing atom families from store.ts which have the
 * complex logic for pending column changes and dirty detection.
 */
const baseMolecule = createMolecule<FlattenedTestcase, FlattenedTestcase>({
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
 * Tracks which revision currently has local entities - prevents cleanup from clearing them
 */
const localEntitiesRevisionAtom = atom<string | null>(null)

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

// ============================================================================
// ACTION ATOMS
// ============================================================================

/**
 * Add a new testcase action
 * Creates a validated local testcase using the schema factory
 * @returns {id: string, data: FlattenedTestcase} | null if validation fails
 */
const addTestcaseAtom = atom(null, (_get, set, initialData?: Partial<FlattenedTestcase>) => {
    const result = createTestcase(initialData)

    if (!result.success) {
        console.error("[testcase] Invalid data for new testcase:", result.errors)
        return null
    }

    const data = result.data as FlattenedTestcase

    // Add to new IDs tracking
    set(addNewEntityIdAtom, data.id)

    // Initialize draft with data
    set(testcaseDraftAtomFamily(data.id), data)

    return {id: data.id, data}
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
 * Append multiple testcases action
 * Creates multiple validated testcases from row data using the schema factory
 * @returns Number of testcases successfully added
 */
const appendTestcasesAtom = atom(null, (_get, set, rows: Record<string, unknown>[]) => {
    let count = 0
    for (const row of rows) {
        const result = createTestcase(row as Partial<FlattenedTestcase>)

        if (!result.success) {
            console.error("[testcase] Skipping invalid row:", result.errors)
            continue
        }

        const data = result.data as FlattenedTestcase

        // Add to new IDs tracking
        set(addNewEntityIdAtom, data.id)

        // Initialize draft with data
        set(testcaseDraftAtomFamily(data.id), data)

        count++
    }
    return count
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
}

/**
 * Create multiple validated testcases with options using the schema factory
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
            const result = createTestcase(row as Partial<FlattenedTestcase>)

            if (!result.success) {
                console.error("[testcase] Skipping invalid row:", result.errors)
                errors++
                continue
            }

            const data = result.data as FlattenedTestcase

            // Add to new IDs tracking
            set(addNewEntityIdAtom, data.id)

            // Initialize draft with data
            set(testcaseDraftAtomFamily(data.id), data)

            ids.push(data.id)
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
        /** Track which revision has local entities */
        localEntitiesRevision: localEntitiesRevisionAtom,
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
            updates: {id: string; updates: Partial<FlattenedTestcase>}[],
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
 */
const testcaseControllerAtomFamily = createControllerAtomFamily<
    FlattenedTestcase,
    Partial<FlattenedTestcase>
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
 * Uses createMolecule + extendMolecule + createControllerAtomFamily pattern
 * for consistency with other entities (trace, testset, revision).
 */
export const testcaseMolecule = {
    /** Entity name */
    name: "testcase" as const,

    // Controller for EntityDrillInView compatibility
    controller: testcaseControllerAtomFamily,

    // Selectors - aliases for common atoms
    selectors: {
        /** Merged data atom (server + draft with pending column changes) */
        data: testcaseEntityAtomFamily,
        /** Server data only */
        serverData: baseMolecule.atoms.serverData,
        /** Draft data atom */
        draft: testcaseDraftAtomFamily,
        /** isDirty atom (column-aware) */
        isDirty: testcaseIsDirtyAtomFamily,
        /** Query state */
        query: testcaseQueryAtomFamily,
        /** Current columns derived from all entities */
        columns: currentColumnsAtom,
        /** New entity IDs (local only) */
        newEntityIds: newEntityIdsAtom,
        /** Local columns per revision (writable) */
        localColumnsFamily: localColumnsAtomFamily,
        /** Track which revision has local entities */
        localEntitiesRevision: localEntitiesRevisionAtom,
    },

    // Atoms from extended molecule
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

    // Reducers - include base + extended
    reducers: {
        ...extendedMolecule.reducers,
        /** Update testcase (overridden to use store's update) */
        update: updateTestcaseAtom,
        /** Discard draft (overridden to use store's discard) */
        discard: discardDraftAtom,
    },

    // Backward-compatible actions alias
    actions: {
        update: updateTestcaseAtom,
        discard: discardDraftAtom,
        /** Add a new testcase - returns {id, data} */
        add: addTestcaseAtom,
        /** Delete testcases by ID(s) - soft delete for server entities, full remove for local */
        delete: deleteTestcasesAtom,
        /** Append multiple testcases from row data - returns count */
        append: appendTestcasesAtom,
        /** Create multiple testcases with options - returns {ids, count} */
        create: createTestcasesAtom,
    },

    // DrillIn utilities for path-based navigation and editing
    drillIn: {
        getValueAtPath,
        getRootItems,
        getChangesFromPath,
        valueMode: "native" as const,
        /**
         * Extract root data for navigation.
         * For testcases, the entity itself is the root data.
         */
        getRootData: (entity: FlattenedTestcase | null) => entity,
        /**
         * Convert path-based changes back to entity draft format.
         * For testcases, the path[0] is the column key.
         */
        getChangesFromRoot: (
            entity: FlattenedTestcase | null,
            _rootData: unknown,
            path: DataPath,
            value: unknown,
        ): Partial<FlattenedTestcase> | null => {
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
