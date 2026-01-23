/**
 * Revision Molecule
 *
 * Provides unified state management for revision entities using the molecule pattern.
 *
 * ## Usage
 *
 * ```typescript
 * import { revisionMolecule } from '@agenta/entities/testset'
 *
 * // In components - use the React hook
 * const [state, dispatch] = revisionMolecule.useController(revisionId)
 * dispatch.update({ message: 'Updated commit message' })
 *
 * // In atoms - use atoms directly
 * const dataAtom = revisionMolecule.atoms.data(revisionId)
 * const isDirtyAtom = revisionMolecule.atoms.isDirty(revisionId)
 *
 * // Imperatively (in callbacks)
 * const data = revisionMolecule.get.data(revisionId)
 * revisionMolecule.set.update(revisionId, { message: 'New message' })
 * ```
 */

import {isValidUUID, axios, getAgentaApiUrl} from "@agenta/shared"
import {atom} from "jotai"
import {getDefaultStore} from "jotai/vanilla"
import {atomFamily} from "jotai-family"
import {atomWithQuery} from "jotai-tanstack-query"

import {createMolecule, extendMolecule, createControllerAtomFamily} from "../../shared"
import type {AtomFamily, QueryState, PathItem} from "../../shared"
import {testcaseMolecule} from "../../testcase/state/molecule"
import {
    getValueAtPath as getValueAtPathUtil,
    setValueAtPath,
    getItemsAtPath,
    type DataPath,
} from "../../ui"
import {normalizeRevision, type Revision, type QueryResult} from "../core"

// Import testcase molecule for compound actions
import {
    revisionTableState,
    pendingColumnOpsAtomFamily,
    pendingRowOpsAtomFamily,
    hasPendingChangesAtomFamily,
    addColumnReducer,
    removeColumnReducer,
    renameColumnReducer,
    addRowReducer,
    removeRowReducer,
    removeRowsReducer,
    clearPendingOpsReducer,
    createEffectiveColumnsAtomFamily,
    createEffectiveRowIdsAtomFamily,
    createRowRefsAtomFamily,
    type TableColumn,
    type RowRef,
    type PendingColumnOps,
    type PendingRowOps,
} from "./revisionTableState"
import {
    revisionQueryAtomFamily,
    revisionDraftAtomFamily,
    revisionsListQueryAtomFamily,
    enableRevisionsListQueryAtom,
    latestRevisionForTestsetAtomFamily,
    invalidateRevisionsListCache,
} from "./store"

// ============================================================================
// NULL-SAFE QUERY UTILITIES
// ============================================================================

/**
 * Null query result for use when no ID is provided.
 * Prevents unnecessary network requests for empty/null IDs.
 */
const nullQueryResultAtom = atom<QueryResult<Revision>>(() => ({
    data: null,
    isPending: false,
    isError: false,
    error: null,
}))

/**
 * Null data atom for use when no ID is provided.
 */
const nullDataAtom = atom<Revision | null>(() => null)

// ============================================================================
// BASE MOLECULE
// ============================================================================

/**
 * Base revision molecule with core state management
 */
const baseRevisionMolecule = createMolecule<Revision, Partial<Revision>>({
    name: "revision",
    // Type assertion: jotai-family's atomFamily type is structurally compatible but needs cast
    queryAtomFamily: revisionQueryAtomFamily as AtomFamily<QueryState<Revision>>,
    draftAtomFamily: revisionDraftAtomFamily,
    transform: normalizeRevision,
    // Revisions are immutable - if draft exists, it's dirty
    isDirty: (_serverData, draft) => draft !== null,
    // Revisions don't have "new" entities in the same way
    isNewEntity: () => false,
})

// ============================================================================
// REVISION WITH TESTCASES QUERY
// ============================================================================

/**
 * Store projectId per revision - set when query is enabled
 * This avoids relying on a global projectIdAtom that may not be synced
 */
const revisionProjectIdMapAtom = atom<Map<string, string>>(new Map())

/**
 * Track which revisions have had their withTestcases query enabled
 */
const revisionWithTestcasesEnabledAtom = atom<Set<string>>(new Set<string>())

/**
 * Enable the revision with testcases query for a specific revision
 */
export const enableRevisionWithTestcasesQueryAtom = atom(
    null,
    (get, set, params: {revisionId: string; projectId: string}) => {
        const {revisionId, projectId} = params

        // Store the projectId for this revision
        const projectIdMap = new Map(get(revisionProjectIdMapAtom))
        projectIdMap.set(revisionId, projectId)
        set(revisionProjectIdMapAtom, projectIdMap)

        // Mark as enabled
        const enabled = new Set(get(revisionWithTestcasesEnabledAtom))
        enabled.add(revisionId)
        set(revisionWithTestcasesEnabledAtom, enabled)
    },
)

/**
 * Query atom family for fetching a revision WITH testcases included.
 * Use this when you need to derive column names from testcase data.
 */
const revisionWithTestcasesQueryAtomFamily = atomFamily((revisionId: string) =>
    atomWithQuery<Revision | null>((get) => {
        // Get projectId from the map (set when query was enabled)
        const projectIdMap = get(revisionProjectIdMapAtom)
        const projectId = projectIdMap.get(revisionId) ?? null
        const enabledSet = get(revisionWithTestcasesEnabledAtom)
        const isEnabled =
            enabledSet.has(revisionId) &&
            Boolean(projectId && revisionId && isValidUUID(revisionId))

        return {
            queryKey: ["revision-with-testcases", projectId, revisionId],
            queryFn: async () => {
                if (!projectId || !revisionId || !isValidUUID(revisionId)) {
                    return null
                }

                try {
                    const response = await axios.post(
                        `${getAgentaApiUrl()}/preview/testsets/revisions/query`,
                        {
                            testset_revision_refs: [{id: revisionId}],
                            windowing: {limit: 1},
                        },
                        {params: {project_id: projectId, include_testcases: true}},
                    )

                    const revisions = response.data?.testset_revisions ?? []
                    if (revisions.length === 0) return null

                    return normalizeRevision(revisions[0])
                } catch (error) {
                    console.error("[revisionWithTestcasesQuery] Failed to fetch:", error)
                    return null
                }
            },
            enabled: isEnabled,
            staleTime: 5 * 60 * 1000,
            gcTime: 10 * 60 * 1000,
        }
    }),
)

/**
 * Query result version with loading/error states
 */
const withTestcasesQueryResultAtomFamily = atomFamily((revisionId: string) =>
    atom((get): QueryResult<Revision> => {
        const queryState = get(revisionWithTestcasesQueryAtomFamily(revisionId))
        return {
            data: queryState.data ?? null,
            isPending: queryState.isPending,
            isError: queryState.isError,
            error: queryState.error,
        }
    }),
)

// ============================================================================
// COLUMN EXPANSION UTILITIES
// ============================================================================

/** Maximum depth for recursive column expansion */
const MAX_COLUMN_DEPTH = 5

/** Column with optional parent info for grouping */
interface ExpandedColumn {
    key: string
    label: string
    parentKey?: string
}

/**
 * Try to parse a value as a plain object (handles JSON strings)
 * Arrays are NOT treated as objects - they should be displayed as JSON
 */
function tryParseAsObject(value: unknown): Record<string, unknown> | null {
    if (Array.isArray(value)) return null
    if (value && typeof value === "object") {
        return value as Record<string, unknown>
    }
    if (typeof value === "string") {
        const trimmed = value.trim()
        if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
            try {
                const parsed = JSON.parse(trimmed)
                if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
                    return parsed as Record<string, unknown>
                }
            } catch {
                // Not valid JSON
            }
        }
    }
    return null
}

/**
 * Check if a value is an array (handles JSON strings too)
 */
function isArrayValue(value: unknown): boolean {
    if (Array.isArray(value)) return true
    if (typeof value === "string") {
        const trimmed = value.trim()
        if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
            try {
                return Array.isArray(JSON.parse(trimmed))
            } catch {
                return false
            }
        }
    }
    return false
}

/**
 * Recursively collect object sub-keys
 */
function collectObjectSubKeysRecursive(
    obj: Record<string, unknown>,
    prefix: string,
    objectSubKeys: Map<string, Set<string>>,
    currentDepth: number,
): void {
    if (currentDepth >= MAX_COLUMN_DEPTH) return

    Object.entries(obj).forEach(([subKey, subValue]) => {
        const fullPath = prefix ? `${prefix}.${subKey}` : subKey

        // Skip arrays - display as JSON, don't expand
        if (isArrayValue(subValue)) {
            const parentSubKeys = objectSubKeys.get(prefix) || new Set<string>()
            parentSubKeys.add(subKey)
            objectSubKeys.set(prefix, parentSubKeys)
            return
        }

        const nestedObj = tryParseAsObject(subValue)

        // Skip empty objects
        if (nestedObj && Object.keys(nestedObj).length === 0) return

        // Add this subKey to the parent's set
        const parentSubKeys = objectSubKeys.get(prefix) || new Set<string>()
        parentSubKeys.add(subKey)
        objectSubKeys.set(prefix, parentSubKeys)

        // Recurse if nested object
        if (nestedObj && Object.keys(nestedObj).length > 0) {
            collectObjectSubKeysRecursive(nestedObj, fullPath, objectSubKeys, currentDepth + 1)
        }
    })
}

/**
 * Recursively expand a column path into sub-columns
 */
function expandColumnRecursive(
    parentPath: string,
    objectSubKeys: Map<string, Set<string>>,
    results: ExpandedColumn[],
): void {
    const subKeys = objectSubKeys.get(parentPath)
    if (!subKeys || subKeys.size === 0) return

    const sortedSubKeys = Array.from(subKeys).sort()
    sortedSubKeys.forEach((subKey) => {
        const fullPath = `${parentPath}.${subKey}`
        const nestedSubKeys = objectSubKeys.get(fullPath)

        if (nestedSubKeys && nestedSubKeys.size > 0) {
            // Recurse into nested object
            expandColumnRecursive(fullPath, objectSubKeys, results)
        } else {
            // Leaf node - add as column with parentKey for grouping
            results.push({
                key: fullPath,
                label: subKey,
                parentKey: parentPath,
            })
        }
    })
}

/**
 * Derive column names from revision testcases (base columns - no expansion)
 */
const testcaseColumnsAtomFamily = atomFamily((revisionId: string) =>
    atom((get): string[] => {
        const queryState = get(revisionWithTestcasesQueryAtomFamily(revisionId))
        const revision = queryState.data

        if (!revision?.data?.testcases) return []

        const testcases = revision.data.testcases
        if (!Array.isArray(testcases)) return []

        const columnMap = new Map<string, string>()

        testcases.forEach((testcase) => {
            if (!testcase || typeof testcase !== "object") return
            const userData = (testcase as {data?: Record<string, unknown>}).data
            if (!userData || typeof userData !== "object") return

            Object.keys(userData).forEach((key) => {
                const lowerKey = key.toLowerCase()
                if (!columnMap.has(lowerKey)) {
                    columnMap.set(lowerKey, key)
                }
            })
        })

        return Array.from(columnMap.values())
    }),
)

/**
 * Derive EXPANDED columns from revision testcases
 * Recursively expands object-type columns into sub-columns with parentKey set
 *
 * For new testsets (no server data), derives columns from local testcase data
 * via testcaseMolecule.atoms.columns - unified API, no component-level branching
 */
const expandedTestcaseColumnsAtomFamily = atomFamily((revisionId: string) =>
    atom((get): ExpandedColumn[] => {
        const queryState = get(revisionWithTestcasesQueryAtomFamily(revisionId))
        const revision = queryState.data

        // For new testsets, get columns from local testcase data
        // This provides a unified API - component doesn't need to branch
        if (!revision?.data?.testcases || revision.data.testcases.length === 0) {
            const localColumns = get(testcaseMolecule.atoms.columns)
            if (localColumns.length > 0) {
                return localColumns.map((col) => ({
                    key: col.key,
                    label: col.label || col.key,
                }))
            }
            return []
        }

        const testcases = revision.data.testcases
        if (!Array.isArray(testcases)) return []

        // Collect base columns and detect objects
        const baseColumnMap = new Map<string, string>()
        const objectSubKeys = new Map<string, Set<string>>()

        testcases.forEach((testcase) => {
            if (!testcase || typeof testcase !== "object") return
            const userData = (testcase as {data?: Record<string, unknown>}).data
            if (!userData || typeof userData !== "object") return

            Object.entries(userData).forEach(([key, value]) => {
                const lowerKey = key.toLowerCase()
                if (!baseColumnMap.has(lowerKey)) {
                    baseColumnMap.set(lowerKey, key)
                }

                // Check if value is an object that should be expanded
                const obj = tryParseAsObject(value)
                if (obj && Object.keys(obj).length > 0) {
                    collectObjectSubKeysRecursive(obj, key, objectSubKeys, 1)
                }
            })
        })

        // Build expanded columns
        const expandedColumns: ExpandedColumn[] = []
        const baseColumns = Array.from(baseColumnMap.values())

        baseColumns.forEach((colKey) => {
            const subKeys = objectSubKeys.get(colKey)
            if (subKeys && subKeys.size > 0) {
                // Object column - expand into sub-columns
                expandColumnRecursive(colKey, objectSubKeys, expandedColumns)
            } else {
                // Regular column - no parentKey
                expandedColumns.push({key: colKey, label: colKey})
            }
        })

        return expandedColumns
    }),
)

/**
 * Normalized column names (lowercase) for matching
 */
const testcaseColumnsNormalizedAtomFamily = atomFamily((revisionId: string) =>
    atom((get): string[] => {
        const columns = get(testcaseColumnsAtomFamily(revisionId))
        return columns.map((col) => col.trim().toLowerCase()).filter(Boolean)
    }),
)

// ============================================================================
// SERVER ROW IDS (from revision data)
// ============================================================================

/**
 * Server row IDs derived from revision data
 * These are the testcase IDs that exist on the server for this revision
 */
const serverRowIdsAtomFamily = atomFamily((revisionId: string) =>
    atom((get): string[] => {
        const queryState = get(revisionWithTestcasesQueryAtomFamily(revisionId))
        const revision = queryState.data

        if (!revision?.data) return []

        // Try testcase_ids first (array of IDs)
        if (revision.data.testcase_ids && Array.isArray(revision.data.testcase_ids)) {
            return revision.data.testcase_ids
        }

        // Fall back to extracting IDs from embedded testcases
        if (revision.data.testcases && Array.isArray(revision.data.testcases)) {
            return revision.data.testcases
                .map((tc) => (tc as {id?: string}).id)
                .filter((id): id is string => Boolean(id))
        }

        return []
    }),
)

/**
 * Base columns as TableColumn[] (for use with createEffectiveColumnsAtomFamily)
 */
const baseColumnsAsTableColumnAtomFamily = atomFamily((revisionId: string) =>
    atom((get): TableColumn[] => {
        const expandedColumns = get(expandedTestcaseColumnsAtomFamily(revisionId))
        return expandedColumns.map((col) => ({
            key: col.key,
            label: col.label,
            parentKey: col.parentKey,
        }))
    }),
)

// ============================================================================
// EFFECTIVE STATE (base + pending operations)
// ============================================================================

/**
 * Effective columns = base columns + pending column operations
 */
const effectiveColumnsAtomFamily = createEffectiveColumnsAtomFamily(
    baseColumnsAsTableColumnAtomFamily,
)

/**
 * Effective row IDs = server row IDs + pending row operations
 */
const effectiveRowIdsAtomFamily = createEffectiveRowIdsAtomFamily(serverRowIdsAtomFamily)

/**
 * Row refs with metadata (__isNew, __isDeleted)
 */
const rowRefsAtomFamily = createRowRefsAtomFamily(serverRowIdsAtomFamily)

/**
 * Loading state for revision with testcases
 */
const isLoadingAtomFamily = atomFamily((revisionId: string) =>
    atom((get): boolean => {
        const queryState = get(revisionWithTestcasesQueryAtomFamily(revisionId))
        return queryState.isPending
    }),
)

// ============================================================================
// COMPOUND ACTIONS (Entity Uniformity)
// These actions create entities that are indistinguishable from server entities
// via molecule APIs. Local vs server should only affect:
// - __isNew flag (for UI indicators)
// - Mutation availability (commit requires server entity)
// ============================================================================

/**
 * Standard prefix detection for local entities
 * All local entities use consistent prefixes for isNew detection
 */
const isLocalEntity = (id: string): boolean =>
    id.startsWith("local-") || id.startsWith("new-") || id.startsWith("draft-")

/**
 * Create a testcase row linked to a revision
 *
 * This compound action:
 * 1. Creates a testcase entity (via testcase.actions.create)
 * 2. Links it to the revision's pending rows (via addRowReducer)
 *
 * The created entity is indistinguishable from server entities via molecule APIs.
 *
 * @example
 * ```typescript
 * const createRow = useSetAtom(revision.tableReducers.createRowForRevision)
 * const entityId = createRow({
 *   revisionId: 'rev-123',
 *   initialData: { name: 'Test', input: 'Hello' },
 *   prefix: 'local-',
 * })
 * ```
 */
const createRowForRevisionReducer = atom(
    null,
    (
        get,
        set,
        params: {
            revisionId: string
            initialData: Record<string, unknown>
            prefix?: string
        },
    ): string => {
        const {revisionId, initialData, prefix = "local-"} = params

        // Create testcase entity via testcase molecule
        // This creates a draft entity with the same shape as server entities
        const result = set(testcaseMolecule.actions.create, {
            rows: [initialData],
            prefix,
            skipDeduplication: true,
            skipColumnSync: true,
        })

        const entityId = result.ids[0]

        // Link entity to revision's pending rows
        set(addRowReducer, {revisionId, rowId: entityId})

        return entityId
    },
)

/**
 * Create multiple testcase rows linked to a revision
 *
 * @example
 * ```typescript
 * const createRows = useSetAtom(revision.tableReducers.createRowsForRevision)
 * const entityIds = createRows({
 *   revisionId: 'rev-123',
 *   rowsData: [
 *     { name: 'Test 1', input: 'Hello' },
 *     { name: 'Test 2', input: 'World' },
 *   ],
 *   prefix: 'local-',
 * })
 * ```
 */
const createRowsForRevisionReducer = atom(
    null,
    (
        get,
        set,
        params: {
            revisionId: string
            rowsData: Record<string, unknown>[]
            prefix?: string
        },
    ): string[] => {
        const {revisionId, rowsData, prefix = "local-"} = params
        const entityIds: string[] = []

        for (const rowData of rowsData) {
            const entityId = set(createRowForRevisionReducer, {
                revisionId,
                initialData: rowData,
                prefix,
            })
            entityIds.push(entityId)
        }

        return entityIds
    },
)

// ============================================================================
// EXTENDED MOLECULE
// ============================================================================

/**
 * Extended revision molecule with testcases query
 */
const extendedRevisionMolecule = extendMolecule(baseRevisionMolecule, {
    atoms: {
        /** Revision with testcases included (for column derivation) */
        withTestcases: revisionWithTestcasesQueryAtomFamily as AtomFamily<unknown>,
        /** Query result with loading/error states */
        withTestcasesQueryResult: withTestcasesQueryResultAtomFamily as AtomFamily<
            QueryResult<Revision>
        >,
        /** Column names derived from testcases (base - no expansion) */
        testcaseColumns: testcaseColumnsAtomFamily as AtomFamily<string[]>,
        /** Expanded columns with parentKey for grouping (objects expanded into sub-columns) */
        expandedColumns: expandedTestcaseColumnsAtomFamily as AtomFamily<ExpandedColumn[]>,
        /** Normalized column names (lowercase) for matching */
        testcaseColumnsNormalized: testcaseColumnsNormalizedAtomFamily as AtomFamily<string[]>,
        /** Revisions list for a testset */
        list: revisionsListQueryAtomFamily as AtomFamily<unknown>,
        /** Latest revision for a testset */
        latestForTestset: latestRevisionForTestsetAtomFamily as AtomFamily<unknown>,
        /** Enable lazy list query atom (use with useSetAtom) */
        enableList: enableRevisionsListQueryAtom,
        /** Enable revision with testcases query (for column derivation) */
        enableWithTestcases: enableRevisionWithTestcasesQueryAtom,

        // ================================================================
        // TABLE STATE (revision-level columns and rows)
        // ================================================================

        /** Server row IDs from revision data */
        serverRowIds: serverRowIdsAtomFamily as AtomFamily<string[]>,
        /** Pending column operations (add, remove, rename) */
        pendingColumnOps: pendingColumnOpsAtomFamily as AtomFamily<PendingColumnOps>,
        /** Pending row operations (add, remove) */
        pendingRowOps: pendingRowOpsAtomFamily as AtomFamily<PendingRowOps>,
        /** Effective columns (base + pending ops) */
        effectiveColumns: effectiveColumnsAtomFamily as AtomFamily<TableColumn[]>,
        /** Effective row IDs (server + pending ops) */
        effectiveRowIds: effectiveRowIdsAtomFamily as AtomFamily<string[]>,
        /** Row refs with __isNew, __isDeleted metadata */
        rowRefs: rowRefsAtomFamily as AtomFamily<RowRef[]>,
        /** Has any pending changes (columns or rows) */
        hasPendingChanges: hasPendingChangesAtomFamily as AtomFamily<boolean>,
        /** Is loading revision with testcases */
        isLoading: isLoadingAtomFamily as AtomFamily<boolean>,
    },
})

// ============================================================================
// DRILL-IN HELPERS
// ============================================================================

/**
 * Get value at path from revision data
 */
function getValueAtPath(data: Revision | null, path: DataPath): unknown {
    if (!data) return undefined
    return getValueAtPathUtil(data, path)
}

/**
 * Get root items for navigation.
 * Returns the top-level revision fields.
 */
function getRootItems(data: Revision | null): PathItem[] {
    if (!data) return []
    return getItemsAtPath(data, [])
}

/**
 * Convert path-based changes to draft format.
 * For revisions, the entire entity is draftable.
 */
function getChangesFromPath(
    data: Revision | null,
    path: DataPath,
    value: unknown,
): Partial<Revision> | null {
    if (!data || path.length === 0) return null

    // Build the update using setValueAtPath
    const updated = setValueAtPath(data, path, value)

    // Extract the changes (top-level key that changed)
    const topKey = path[0]
    if (typeof topKey === "string") {
        return {
            [topKey]: (updated as Record<string, unknown>)[topKey],
        } as Partial<Revision>
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
const revisionControllerAtomFamily = createControllerAtomFamily<Revision, Partial<Revision>>({
    dataAtom: extendedRevisionMolecule.atoms.data,
    isDirtyAtom: extendedRevisionMolecule.atoms.isDirty,
    queryAtom: extendedRevisionMolecule.atoms.query,
    updateReducer: extendedRevisionMolecule.reducers.update,
    discardReducer: extendedRevisionMolecule.reducers.discard,
    drillIn: {
        getChangesFromPath,
    },
})

/**
 * Full revision molecule with selectors alias for backwards compatibility
 */
export const revisionMolecule = {
    ...extendedRevisionMolecule,

    /**
     * Controller atom family for state + dispatch pattern.
     * @example const [state, dispatch] = useAtom(revisionMolecule.controller(id))
     */
    controller: revisionControllerAtomFamily,

    /**
     * Selectors - alias for atoms that provide query state
     * For compatibility with component patterns that expect `revision.selectors.query(id)`
     */
    selectors: {
        /** Query atom for revision data with loading/error states */
        query: revisionQueryAtomFamily as AtomFamily<QueryState<Revision>>,
        /**
         * Null-safe query selector. Returns null query result when id is null/undefined.
         * Prevents unnecessary network requests for empty IDs.
         * @example const query = useAtomValue(revisionMolecule.selectors.queryOptional(id))
         */
        queryOptional: (id: string | null | undefined) =>
            // Cast needed: return type must match nullQueryResultAtom for union compatibility
            id ? (revisionQueryAtomFamily(id) as typeof nullQueryResultAtom) : nullQueryResultAtom,
        /** Merged data atom (server + draft) */
        data: extendedRevisionMolecule.atoms.data,
        /**
         * Null-safe data selector. Returns null when id is null/undefined.
         * @example const data = useAtomValue(revisionMolecule.selectors.dataOptional(id))
         */
        dataOptional: (id: string | null | undefined) =>
            id ? extendedRevisionMolecule.atoms.data(id) : nullDataAtom,
        /** Raw server data (without draft) */
        serverData: extendedRevisionMolecule.atoms.serverData,
        /** Draft data atom */
        draft: extendedRevisionMolecule.atoms.draft,
        /** isDirty atom */
        isDirty: extendedRevisionMolecule.atoms.isDirty,
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
     * Table reducers for column and row operations
     */
    tableReducers: {
        /** Add a column to the revision */
        addColumn: addColumnReducer,
        /** Remove a column from the revision */
        removeColumn: removeColumnReducer,
        /** Rename a column in the revision */
        renameColumn: renameColumnReducer,
        /** Add a new row (creates local testcase) */
        addRow: addRowReducer,
        /** Remove a row (marks for deletion or removes local) */
        removeRow: removeRowReducer,
        /** Remove multiple rows */
        removeRows: removeRowsReducer,
        /** Clear all pending operations */
        clearPendingOps: clearPendingOpsReducer,

        // Compound actions (Entity Uniformity pattern)
        /**
         * Create a testcase row linked to this revision (compound action)
         * Creates entity + links to revision's pending rows in one step
         */
        createRowForRevision: createRowForRevisionReducer,
        /**
         * Create multiple testcase rows linked to this revision (compound action)
         * Batch version of createRowForRevision
         */
        createRowsForRevision: createRowsForRevisionReducer,
    },

    /**
     * Imperative API for table operations (base + compound actions)
     */
    table: {
        ...revisionTableState,
        set: {
            ...revisionTableState.set,
            /**
             * Create a testcase row linked to revision (imperative API)
             * @returns The created entity ID
             */
            createRowForRevision: (params: {
                revisionId: string
                initialData: Record<string, unknown>
                prefix?: string
            }): string => {
                const store = getDefaultStore()
                return store.set(createRowForRevisionReducer, params)
            },
            /**
             * Create multiple testcase rows linked to revision (imperative API)
             * @returns Array of created entity IDs
             */
            createRowsForRevision: (params: {
                revisionId: string
                rowsData: Record<string, unknown>[]
                prefix?: string
            }): string[] => {
                const store = getDefaultStore()
                return store.set(createRowsForRevisionReducer, params)
            },
        },
    },

    /**
     * Utility functions for entity uniformity
     */
    utils: {
        /** Check if an entity ID represents a local (unsaved) entity */
        isLocalEntity,
    },
}

// ============================================================================
// TYPES
// ============================================================================

export type RevisionMolecule = typeof revisionMolecule

// ============================================================================
// CACHE INVALIDATION
// ============================================================================

/**
 * Invalidate revisions list cache for a testset
 */
export {invalidateRevisionsListCache}
