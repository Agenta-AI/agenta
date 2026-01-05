/**
 * Revision Entity Controller
 *
 * Provides a unified, simplified API for working with testset revision entities.
 * Follows the same pattern as testcase controller for consistency.
 *
 * ## Key Difference from Testcase Controller
 *
 * While testcases use `createEntityController` factory, revisions have a simpler
 * structure (no drill-in editing) and manage column state at the revision level.
 *
 * ## Usage
 *
 * ```typescript
 * import { revision } from '@/state/entities/testset'
 *
 * // Full controller (state + dispatch)
 * function RevisionEditor({ revisionId }: { revisionId: string }) {
 *   const [rev, dispatch] = useAtom(revision.controller(revisionId))
 *
 *   if (rev.isPending) return <Skeleton />
 *   if (rev.isError) return <ErrorDisplay error={rev.error} />
 *   if (!rev.data) return <NotFound />
 *
 *   return (
 *     <div>
 *       <h1>{rev.data.testset?.name}</h1>
 *       <Button onClick={() => dispatch({ type: 'addColumn', name: 'newColumn' })}>
 *         Add Column
 *       </Button>
 *       <Button onClick={() => dispatch({ type: 'save' })}>
 *         Save Changes
 *       </Button>
 *     </div>
 *   )
 * }
 *
 * // Efficient selectors
 * const columns = useAtomValue(revision.selectors.columns(revisionId))
 * const isDirty = useAtomValue(revision.selectors.isDirty(revisionId))
 *
 * // Actions in other atoms
 * set(revision.actions.addColumn, 'newColumn')
 * set(revision.actions.renameColumn, { oldName: 'old', newName: 'new' })
 * ```
 */

import {atom} from "jotai"
import {atomFamily} from "jotai/utils"
import {atomWithQuery} from "jotai-tanstack-query"

import axios from "@/oss/lib/api/assets/axiosConfig"
import {getAgentaApiUrl} from "@/oss/lib/helpers/api"
import {projectIdAtom} from "@/oss/state/project/selectors/project"

// Note: QueryResult type is used by revisionWithTestcasesQueryResultAtomFamily
import type {QueryResult} from "../shared"
import {
    addColumnAtom,
    clearPendingAddedColumnsAtom,
    clearPendingDeletedColumnsAtom,
    clearPendingRenamesAtom,
    type Column,
    currentColumnsAtom,
    deleteColumnAtom,
    deletedColumnsAtom,
    type ExpandedColumn,
    expandedColumnsAtom,
    hasColumnChangesAtom,
    localColumnsAtom,
    pendingAddedColumnsAtom,
    pendingColumnRenamesAtom,
    pendingDeletedColumnsAtom,
    renameColumnAtom,
    resetColumnsAtom,
} from "../testcase/columnState"

import {hasUnsavedChangesAtom, changesSummaryAtom, type ChangesSummary} from "./dirtyState"
import {
    clearRevisionDraftAtom,
    enableRevisionsListQueryAtom,
    revisionDraftAtomFamily,
    revisionEntityAtomFamily,
    revisionIsDirtyAtomFamily,
    revisionQueryAtomFamily,
    revisionsListQueryAtomFamily,
    updateRevisionDraftAtom,
} from "./revisionEntity"
import {normalizeRevision, type Revision} from "./revisionSchema"
import {invalidateRevisionsListCache} from "./store"

// ============================================================================
// SYSTEM FIELDS (excluded from column derivation)
// ============================================================================

const SYSTEM_FIELDS = new Set([
    "id",
    "key",
    "testset_id",
    "set_id",
    "created_at",
    "updated_at",
    "deleted_at",
    "created_by_id",
    "updated_by_id",
    "deleted_by_id",
    "flags",
    "tags",
    "meta",
    "__isSkeleton",
    "testcase_dedup_id",
    "__dedup_id__",
])

// ============================================================================
// REVISION WITH TESTCASES QUERY
// Fetches revision with testcases included (for column derivation)
// ============================================================================

/**
 * Check if a string is a valid UUID
 */
const isValidUUID = (id: string): boolean => {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    return uuidRegex.test(id)
}

/**
 * Query atom family for fetching a revision WITH testcases included.
 * Use this when you need to derive column names from testcase data.
 *
 * Note: This is separate from revisionQueryAtomFamily which fetches WITHOUT testcases
 * for performance reasons in table/list views.
 *
 * @example
 * ```typescript
 * const revisionWithTestcases = useAtomValue(revisionWithTestcasesQueryAtomFamily(revisionId))
 * const columns = revisionWithTestcases.data?.data?.testcases?.map(...)
 * ```
 */
export const revisionWithTestcasesQueryAtomFamily = atomFamily(
    (revisionId: string) =>
        atomWithQuery<Revision | null>((get) => {
            const projectId = get(projectIdAtom)

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
                enabled: Boolean(projectId && revisionId && isValidUUID(revisionId)),
                // Cache for 5 minutes - testcases are immutable per revision
                staleTime: 5 * 60 * 1000,
                gcTime: 10 * 60 * 1000,
            }
        }),
    (a, b) => a === b,
)

/**
 * Query result version of revisionWithTestcasesQuery
 * Includes loading/error states for UI feedback
 */
export const revisionWithTestcasesQueryResultAtomFamily = atomFamily(
    (revisionId: string) =>
        atom((get): QueryResult<Revision> => {
            const queryState = get(revisionWithTestcasesQueryAtomFamily(revisionId))
            return {
                data: queryState.data ?? null,
                isPending: queryState.isPending,
                isError: queryState.isError,
                error: queryState.error,
            }
        }),
    (a, b) => a === b,
)

/**
 * Derive column names from revision testcases.
 * Returns unique column keys found across all testcases, excluding system fields.
 *
 * @example
 * ```typescript
 * const columns = useAtomValue(revisionTestcaseColumnsAtomFamily(revisionId))
 * // Returns: ['input', 'expected_output', 'context', ...]
 * ```
 */
export const revisionTestcaseColumnsAtomFamily = atomFamily(
    (revisionId: string) =>
        atom((get): string[] => {
            const queryState = get(revisionWithTestcasesQueryAtomFamily(revisionId))
            const revision = queryState.data

            if (!revision?.data?.testcases) return []

            const testcases = revision.data.testcases
            if (!Array.isArray(testcases)) return []

            // Collect unique column keys (case-insensitive dedup, preserve original case)
            const columnMap = new Map<string, string>()

            testcases.forEach((testcase) => {
                if (!testcase || typeof testcase !== "object") return

                Object.keys(testcase).forEach((key) => {
                    if (SYSTEM_FIELDS.has(key)) return

                    const lowerKey = key.toLowerCase()
                    if (!columnMap.has(lowerKey)) {
                        columnMap.set(lowerKey, key)
                    }
                })
            })

            return Array.from(columnMap.values())
        }),
    (a, b) => a === b,
)

/**
 * Normalized column names (lowercase, trimmed) for matching
 * Useful for checking if variant variables exist in testset columns
 */
export const revisionTestcaseColumnsNormalizedAtomFamily = atomFamily(
    (revisionId: string) =>
        atom((get): string[] => {
            const columns = get(revisionTestcaseColumnsAtomFamily(revisionId))
            return columns.map((col) => col.trim().toLowerCase()).filter(Boolean)
        }),
    (a, b) => a === b,
)

// ============================================================================
// TYPES
// ============================================================================

/**
 * Controller state combining entity data with loading/error states and column info
 */
export interface RevisionControllerState {
    /** Revision data (server + draft merged) */
    data: Revision | null
    /** Raw server data */
    serverData: Revision | null
    /** Has unsaved changes (any: metadata, columns, testcases) */
    isDirty: boolean
    /** Revision metadata has local draft */
    hasDraft: boolean
    /** Query is pending */
    isPending: boolean
    /** Query has error */
    isError: boolean
    /** Query error */
    error: Error | null
    /** Column state */
    columns: {
        /** Current columns (base columns) */
        current: Column[]
        /** Expanded columns (with object sub-columns) */
        expanded: (Column | ExpandedColumn)[]
        /** Locally added columns */
        local: Column[]
        /** Deleted columns */
        deleted: Set<string>
        /** Pending operations for newly loaded pages */
        pending: {
            renames: Map<string, string>
            added: Set<string>
            deleted: Set<string>
        }
        /** Has column schema changes */
        hasChanges: boolean
    }
    /** Changes summary for commit modal */
    changesSummary: ChangesSummary
}

/**
 * Actions that can be dispatched to the controller
 */
export type RevisionAction =
    | {type: "updateMetadata"; changes: Partial<Revision>}
    | {type: "addColumn"; name: string}
    | {type: "deleteColumn"; key: string}
    | {
          type: "renameColumn"
          oldName: string
          newName: string
          rowDataMap?: Map<string, Record<string, unknown>>
      }
    | {type: "discardDraft"}
    | {type: "resetColumns"}

// ============================================================================
// CONTROLLER ATOM FAMILY
// ============================================================================

/**
 * Full controller atom for a revision
 * Combines all state and provides dispatch function for actions
 */
export const revisionControllerAtomFamily = atomFamily((revisionId: string) =>
    atom(
        (get): RevisionControllerState => {
            // Query state (single source of truth for server data)
            const queryState = get(revisionQueryAtomFamily(revisionId))

            // Entity data (server + draft merged)
            const data = get(revisionEntityAtomFamily(revisionId))
            // Server data derived from query (single source of truth)
            const serverData = queryState.data ?? null

            // Draft state
            const draft = get(revisionDraftAtomFamily(revisionId))
            const hasDraft = draft !== null

            // Dirty state - combines all change types
            const isDirty = get(hasUnsavedChangesAtom)

            // Column state
            const currentColumns = get(currentColumnsAtom)
            const expandedColumns = get(expandedColumnsAtom)
            const localColumns = get(localColumnsAtom)
            const deletedColumns = get(deletedColumnsAtom)
            const pendingRenames = get(pendingColumnRenamesAtom)
            const pendingAdded = get(pendingAddedColumnsAtom)
            const pendingDeleted = get(pendingDeletedColumnsAtom)
            const hasColumnChanges = get(hasColumnChangesAtom)

            // Changes summary
            const changesSummary = get(changesSummaryAtom)

            return {
                data,
                serverData,
                isDirty,
                hasDraft,
                isPending: queryState.isPending,
                isError: queryState.isError,
                error: queryState.error,
                columns: {
                    current: currentColumns,
                    expanded: expandedColumns,
                    local: localColumns,
                    deleted: deletedColumns,
                    pending: {
                        renames: pendingRenames,
                        added: pendingAdded,
                        deleted: pendingDeleted,
                    },
                    hasChanges: hasColumnChanges,
                },
                changesSummary,
            }
        },
        (get, set, action: RevisionAction) => {
            switch (action.type) {
                case "updateMetadata":
                    set(updateRevisionDraftAtom, {
                        revisionId,
                        updates: action.changes,
                    })
                    break

                case "addColumn":
                    set(addColumnAtom, action.name)
                    break

                case "deleteColumn":
                    set(deleteColumnAtom, action.key)
                    break

                case "renameColumn":
                    set(renameColumnAtom, {
                        oldName: action.oldName,
                        newName: action.newName,
                        rowDataMap: action.rowDataMap,
                    })
                    break

                case "discardDraft":
                    set(clearRevisionDraftAtom, revisionId)
                    set(resetColumnsAtom)
                    set(clearPendingRenamesAtom)
                    set(clearPendingAddedColumnsAtom)
                    set(clearPendingDeletedColumnsAtom)
                    break

                case "resetColumns":
                    set(resetColumnsAtom)
                    set(clearPendingRenamesAtom)
                    set(clearPendingAddedColumnsAtom)
                    set(clearPendingDeletedColumnsAtom)
                    break
            }
        },
    ),
)

// ============================================================================
// SELECTORS
// ============================================================================

/**
 * Selector: query state (isPending, isError, error)
 */
const querySelector = revisionQueryAtomFamily

/**
 * Selector: revision entity data (draft merged with server)
 */
const dataSelector = revisionEntityAtomFamily

/**
 * Selector: raw server data (derived from query - single source of truth)
 */
const serverDataSelector = atomFamily(
    (revisionId: string) =>
        atom((get) => {
            const query = get(revisionQueryAtomFamily(revisionId))
            return query.data ?? null
        }),
    (a, b) => a === b,
)

/**
 * Selector: is revision dirty (has any unsaved changes)
 */
const isDirtySelector = atomFamily((revisionId: string) =>
    atom((get) => {
        // First check revision-level draft
        const revisionDirty = get(revisionIsDirtyAtomFamily(revisionId))
        if (revisionDirty) return true

        // Then check aggregate dirty state (testcases + columns)
        return get(hasUnsavedChangesAtom)
    }),
)

/**
 * Selector: current columns
 */
const columnsSelector = atomFamily((_revisionId: string) => atom((get) => get(currentColumnsAtom)))

/**
 * Selector: expanded columns (with object sub-columns)
 */
const expandedColumnsSelector = atomFamily((_revisionId: string) =>
    atom((get) => get(expandedColumnsAtom)),
)

/**
 * Selector: pending column operations
 */
const pendingColumnOpsSelector = atomFamily((_revisionId: string) =>
    atom((get) => ({
        renames: get(pendingColumnRenamesAtom),
        added: get(pendingAddedColumnsAtom),
        deleted: get(pendingDeletedColumnsAtom),
    })),
)

/**
 * Selector: has column schema changes
 */
const hasColumnChangesSelector = atomFamily((_revisionId: string) =>
    atom((get) => get(hasColumnChangesAtom)),
)

/**
 * Selector: changes summary for commit modal
 */
const changesSummarySelector = atomFamily((_revisionId: string) =>
    atom((get) => get(changesSummaryAtom)),
)

/**
 * Selector: testcase-derived columns (fetches with testcases included)
 * Use this when you need to know what columns exist in a revision's testcases
 */
const testcaseColumnsSelector = revisionTestcaseColumnsAtomFamily

/**
 * Selector: normalized testcase columns (lowercase, for matching)
 */
const testcaseColumnsNormalizedSelector = revisionTestcaseColumnsNormalizedAtomFamily

/**
 * Selector: stateful revision with testcases (includes loading/error)
 */
const withTestcasesQueryResultSelector = revisionWithTestcasesQueryResultAtomFamily

// ============================================================================
// ACTIONS (for use in other atoms via set())
// ============================================================================

/**
 * Action: update revision metadata
 */
const updateMetadataAction = updateRevisionDraftAtom

/**
 * Action: add a column
 */
const addColumnAction = addColumnAtom

/**
 * Action: delete a column
 */
const deleteColumnAction = deleteColumnAtom

/**
 * Action: rename a column
 */
const renameColumnAction = renameColumnAtom

/**
 * Action: discard draft for a revision
 */
const discardDraftAction = clearRevisionDraftAtom

/**
 * Action: reset column state
 */
const resetColumnsAction = resetColumnsAtom

// ============================================================================
// UNIFIED REVISION API
// ============================================================================

/**
 * Revision entity API
 *
 * Provides controller, selectors, and actions for revision entities.
 *
 * @example
 * ```typescript
 * // Full controller in components
 * const [rev, dispatch] = useAtom(revision.controller(revisionId))
 * dispatch({ type: 'addColumn', name: 'newColumn' })
 *
 * // Efficient selectors
 * const columns = useAtomValue(revision.selectors.columns(revisionId))
 * const isDirty = useAtomValue(revision.selectors.isDirty(revisionId))
 *
 * // In other atoms
 * set(revision.actions.addColumn, 'newColumn')
 * set(revision.actions.renameColumn, { oldName: 'old', newName: 'new' })
 * ```
 */
export const revision = {
    /**
     * Full controller: state + dispatch
     */
    controller: revisionControllerAtomFamily,

    /**
     * Fine-grained selectors
     */
    selectors: {
        /** Query state (isPending, isError, error) */
        query: querySelector,
        /** Entity data (draft merged) */
        data: dataSelector,
        /** Raw server data */
        serverData: serverDataSelector,
        /** Has unsaved changes */
        isDirty: isDirtySelector,
        /** Current columns */
        columns: columnsSelector,
        /** Expanded columns with sub-columns */
        expandedColumns: expandedColumnsSelector,
        /** Pending column operations */
        pendingColumnOps: pendingColumnOpsSelector,
        /** Has column schema changes */
        hasColumnChanges: hasColumnChangesSelector,
        /** Changes summary for commit */
        changesSummary: changesSummarySelector,
        /**
         * Testcase-derived columns (fetches revision with testcases included)
         * Use when you need to check what columns exist in a testset revision
         */
        testcaseColumns: testcaseColumnsSelector,
        /**
         * Normalized testcase columns (lowercase) for variable matching
         * Use with variant variables to check compatibility
         */
        testcaseColumnsNormalized: testcaseColumnsNormalizedSelector,
        /**
         * Revision with testcases query result (includes loading/error states)
         * Use when you need full testcase data, not just column names
         */
        withTestcasesQueryResult: withTestcasesQueryResultSelector,
    },

    /**
     * Actions for use in other atoms via set()
     */
    actions: {
        /** Update revision metadata */
        updateMetadata: updateMetadataAction,
        /** Add a column */
        addColumn: addColumnAction,
        /** Delete a column */
        deleteColumn: deleteColumnAction,
        /** Rename a column */
        renameColumn: renameColumnAction,
        /** Discard revision draft */
        discardDraft: discardDraftAction,
        /** Reset column state */
        resetColumns: resetColumnsAction,
    },

    /**
     * Query atoms for data fetching
     */
    queries: {
        /**
         * List query: fetch revisions for a testset
         * @param testsetId - The testset ID to fetch revisions for
         *
         * @example
         * ```typescript
         * const query = useAtomValue(revision.queries.list(testsetId))
         * const revisions = query.data?.testset_revisions ?? []
         * ```
         */
        list: revisionsListQueryAtomFamily,

        /**
         * Detail query: fetch single revision
         * @param revisionId - The revision ID
         *
         * @example
         * ```typescript
         * const query = useAtomValue(revision.queries.detail(revisionId))
         * const revision = query.data
         * ```
         */
        detail: revisionQueryAtomFamily,

        /**
         * Enable lazy list query for a testset
         * Call this to enable fetching revisions for a testset
         *
         * @example
         * ```typescript
         * const enableQuery = useSetAtom(revision.queries.enableList)
         * enableQuery(testsetId)
         * ```
         */
        enableList: enableRevisionsListQueryAtom,
    },

    /**
     * Cache invalidation helpers
     * Call these after mutations to refresh data
     */
    invalidate: {
        /**
         * Invalidate revisions list cache for a testset
         * Call after creating/deleting a revision
         * @param testsetId - The testset ID whose revisions to invalidate
         */
        list: invalidateRevisionsListCache,
    },
}

// Re-export types
export type {Column, ExpandedColumn} from "../testcase/columnState"
export type {ChangesSummary} from "./dirtyState"
