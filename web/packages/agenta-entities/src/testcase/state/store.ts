/**
 * Testcase Store
 *
 * Core state management atoms for testcase entities.
 * Provides query atoms with batch fetching, draft state, and entity composition.
 *
 * @example
 * ```typescript
 * import { testcaseQueryAtomFamily, testcaseDraftAtomFamily } from '@agenta/entities/testcase'
 *
 * // Query atom for server data
 * const query = useAtomValue(testcaseQueryAtomFamily(testcaseId))
 *
 * // Draft atom for local changes
 * const [draft, setDraft] = useAtom(testcaseDraftAtomFamily(testcaseId))
 * ```
 */

import {
    axios,
    createBatchFetcher,
    getAgentaApiUrl,
    isValidUUID,
    projectIdAtom,
} from "@agenta/shared"
import {atom, type PrimitiveAtom} from "jotai"
import {selectAtom} from "jotai/utils"
import {atomFamily} from "jotai-family"
import {atomWithQuery, queryClientAtom} from "jotai-tanstack-query"
import get from "lodash/get"

import {createEntityDraftState, normalizeValueForComparison} from "../../shared"
import {pendingColumnOpsAtomFamily} from "../../testset/state/revisionTableState"
import {flattenTestcase, testcaseSchema, SYSTEM_FIELDS, type FlattenedTestcase} from "../core"

// ============================================================================
// CONTEXT ATOMS
// ============================================================================

/**
 * Current revision ID from URL - single source of truth
 *
 * Components set this from URL params, entity atoms read from it.
 */
export const currentRevisionIdAtom = atom<string | null>(null)

/**
 * Set the current revision ID
 * Use this to change the revision context for testcase operations
 */
export const setCurrentRevisionIdAtom = atom(null, (_get, set, revisionId: string | null) => {
    // Direct primitive atom set - type assertion needed for generic atom
    ;(set as (atom: typeof currentRevisionIdAtom, value: string | null) => void)(
        currentRevisionIdAtom,
        revisionId,
    )
})

// ============================================================================
// ID TRACKING ATOMS
// ============================================================================

/**
 * List of testcase IDs from server
 * Accumulated by paginated query as pages load
 */
export const testcaseIdsAtom = atom<string[]>([])

/**
 * Append testcase IDs (called when paginated data arrives)
 * Deduplicates both incoming IDs and against existing IDs
 */
export const setTestcaseIdsAtom = atom(null, (get, set, ids: string[]) => {
    const existing = get(testcaseIdsAtom)
    const existingSet = new Set(existing)
    const uniqueNewIds: string[] = []
    const seenInBatch = new Set<string>()

    for (const id of ids) {
        if (!existingSet.has(id) && !seenInBatch.has(id)) {
            uniqueNewIds.push(id)
            seenInBatch.add(id)
        }
    }

    if (uniqueNewIds.length > 0) {
        set(testcaseIdsAtom, [...existing, ...uniqueNewIds])
    }
})

/**
 * Reset testcase IDs (called when revision changes)
 */
export const resetTestcaseIdsAtom = atom(null, (_get, set) => {
    set(testcaseIdsAtom, [])
})

// ============================================================================
// NEW ENTITY IDS (locally created, not yet saved)
// ============================================================================

const newEntityIdsBaseAtom = atom<string[]>([])
export const newEntityIdsAtom = atom((get) => get(newEntityIdsBaseAtom))

export const addNewEntityIdAtom = atom(null, (get, set, id: string) => {
    const prev = get(newEntityIdsBaseAtom)
    set(newEntityIdsBaseAtom, [...prev, id])
})

export const removeNewEntityIdAtom = atom(null, (get, set, id: string) => {
    const prev = get(newEntityIdsBaseAtom)
    set(
        newEntityIdsBaseAtom,
        prev.filter((i) => i !== id),
    )
})

export const clearNewEntityIdsAtom = atom(null, (_get, set) => {
    set(newEntityIdsBaseAtom, [])
})

// ============================================================================
// DELETED ENTITY IDS (soft deleted, pending save)
// ============================================================================

const deletedEntityIdsBaseAtom = atom<Set<string>>(new Set<string>())
export const deletedEntityIdsAtom = atom((get) => get(deletedEntityIdsBaseAtom))

export const markDeletedAtom = atom(null, (get, set, id: string) => {
    set(deletedEntityIdsBaseAtom, (prev) => new Set([...prev, id]))
})

export const unmarkDeletedAtom = atom(null, (get, set, id: string) => {
    set(deletedEntityIdsBaseAtom, (prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
    })
})

export const clearDeletedIdsAtom = atom(null, (_get, set) => {
    set(deletedEntityIdsBaseAtom, new Set())
})

// ============================================================================
// SELECTION DRAFT STATE (FOR TESTSET SELECTION MODAL)
// ============================================================================

/**
 * Draft selection state per revision (separate from committed testcaseIdsAtom)
 *
 * This is used by TestsetSelectionModal to track pending selection changes
 * before they are committed. The draft is:
 * - null: No draft exists, use displayRowIds as current selection
 * - Set<string>: User has made selection changes, these are the selected IDs
 *
 * Workflow:
 * 1. User opens modal → draft initialized from displayRowIds
 * 2. User toggles rows → draft updated via setSelectionDraft
 * 3. User confirms → draft committed via commitSelectionDraft
 * 4. User cancels → draft discarded via discardSelectionDraft
 */
export const testcaseSelectionDraftAtomFamily = atomFamily(
    (_revisionId: string) => atom<Set<string> | null>(null) as PrimitiveAtom<Set<string> | null>,
)

/**
 * Set the selection draft for a revision
 *
 * @param revisionId - The revision to set draft for
 * @param selectedIds - Array of testcase IDs that are selected
 */
export const setSelectionDraftAtom = atom(
    null,
    (_get, set, revisionId: string, selectedIds: string[]) => {
        set(testcaseSelectionDraftAtomFamily(revisionId), new Set(selectedIds))
    },
)

/**
 * Commit the selection draft to actual testcase selection
 *
 * This updates testcaseIdsAtom to only include the selected IDs.
 * After commit, the draft is cleared.
 */
export const commitSelectionDraftAtom = atom(null, (get, set, revisionId: string) => {
    const draft = get(testcaseSelectionDraftAtomFamily(revisionId))
    if (draft !== null) {
        // Update the testcase IDs to match the selection
        set(testcaseIdsAtom, [...draft])
        // Clear the draft
        set(testcaseSelectionDraftAtomFamily(revisionId), null)
    }
})

/**
 * Discard the selection draft without committing
 *
 * Clears the draft, leaving the current selection unchanged.
 */
export const discardSelectionDraftAtom = atom(null, (_get, set, revisionId: string) => {
    set(testcaseSelectionDraftAtomFamily(revisionId), null)
})

// ============================================================================
// PENDING COLUMN STATE (DERIVED FROM REVISION-LEVEL STATE)
// NOTE: Pending column operations are now managed at the revision level.
// These derived atoms read from pendingColumnOpsAtomFamily for backward compatibility.
// ============================================================================

/**
 * Pending column renames for current revision
 * Derived from revision-level pendingColumnOpsAtomFamily
 */
export const pendingColumnRenamesAtom = atom((get): Map<string, string> => {
    const revisionId = get(currentRevisionIdAtom)
    if (!revisionId) return new Map<string, string>()

    const ops = get(pendingColumnOpsAtomFamily(revisionId))
    const renamesMap = new Map<string, string>()
    for (const rename of ops.rename) {
        renamesMap.set(rename.oldKey, rename.newKey)
    }
    return renamesMap
})

/**
 * Pending column deletions for current revision
 * Derived from revision-level pendingColumnOpsAtomFamily
 */
export const pendingDeletedColumnsAtom = atom((get): Set<string> => {
    const revisionId = get(currentRevisionIdAtom)
    if (!revisionId) return new Set<string>()

    const ops = get(pendingColumnOpsAtomFamily(revisionId))
    return new Set(ops.remove)
})

/**
 * Pending column additions for current revision
 * Derived from revision-level pendingColumnOpsAtomFamily
 */
export const pendingAddedColumnsAtom = atom((get): Set<string> => {
    const revisionId = get(currentRevisionIdAtom)
    if (!revisionId) return new Set<string>()

    const ops = get(pendingColumnOpsAtomFamily(revisionId))
    return new Set(ops.add)
})

// ============================================================================
// BATCH FETCHER
// ============================================================================

interface TestcaseRequest {
    projectId: string
    testcaseId: string
    queryClient?: import("@tanstack/react-query").QueryClient
    revisionId?: string
}

interface PaginatedCachePage {
    rows: FlattenedTestcase[]
    totalCount: number
    nextCursor: string | null
    hasMore: boolean
}

/**
 * Look up testcases in paginated cache
 */
const findMultipleInPaginatedCache = (
    queryClient: import("@tanstack/react-query").QueryClient,
    revisionId: string,
    testcaseIds: string[],
): Map<string, FlattenedTestcase> => {
    const found = new Map<string, FlattenedTestcase>()
    const idsToFind = new Set(testcaseIds)
    const scopeId = `testcases-${revisionId}`

    const queries = queryClient.getQueriesData<PaginatedCachePage>({
        queryKey: ["testcase-paginated", scopeId],
    })

    for (const [_queryKey, data] of queries) {
        if (data?.rows && idsToFind.size > 0) {
            for (const row of data.rows) {
                if (row.id && idsToFind.has(row.id)) {
                    found.set(row.id, row)
                    idsToFind.delete(row.id)
                    if (idsToFind.size === 0) break
                }
            }
        }
        if (idsToFind.size === 0) break
    }

    return found
}

/**
 * Batch fetcher that combines concurrent requests
 */
const testcaseBatchFetcher = createBatchFetcher<
    TestcaseRequest,
    FlattenedTestcase | null,
    Map<string, FlattenedTestcase | null>
>({
    serializeKey: ({projectId, testcaseId}) => `${projectId}:${testcaseId}`,
    batchFn: async (requests, serializedKeys) => {
        const results = new Map<string, FlattenedTestcase | null>()

        // Check paginated cache first
        const cacheCheckGroups = new Map<
            string,
            {
                queryClient: import("@tanstack/react-query").QueryClient
                testcaseIds: string[]
                keyMap: Map<string, string>
            }
        >()

        requests.forEach((req, idx) => {
            const key = serializedKeys[idx]
            if (
                req.queryClient &&
                req.revisionId &&
                req.testcaseId &&
                isValidUUID(req.testcaseId)
            ) {
                const groupKey = req.revisionId
                const existing = cacheCheckGroups.get(groupKey)
                if (existing) {
                    existing.testcaseIds.push(req.testcaseId)
                    existing.keyMap.set(req.testcaseId, key)
                } else {
                    cacheCheckGroups.set(groupKey, {
                        queryClient: req.queryClient,
                        testcaseIds: [req.testcaseId],
                        keyMap: new Map([[req.testcaseId, key]]),
                    })
                }
            }
        })

        // Look up in cache
        for (const [revisionId, {queryClient, testcaseIds, keyMap}] of cacheCheckGroups) {
            const found = findMultipleInPaginatedCache(queryClient, revisionId, testcaseIds)
            for (const [testcaseId, testcase] of found) {
                const serializedKey = keyMap.get(testcaseId)
                if (serializedKey) {
                    results.set(serializedKey, testcase)
                }
            }
        }

        // Fetch remaining from API
        const byProject = new Map<string, {ids: string[]; keys: string[]}>()
        requests.forEach((req, idx) => {
            const key = serializedKeys[idx]
            if (results.has(key)) return
            if (!req.projectId || !req.testcaseId || !isValidUUID(req.testcaseId)) {
                results.set(key, null)
                return
            }
            const existing = byProject.get(req.projectId)
            if (existing) {
                existing.ids.push(req.testcaseId)
                existing.keys.push(key)
            } else {
                byProject.set(req.projectId, {ids: [req.testcaseId], keys: [key]})
            }
        })

        await Promise.all(
            Array.from(byProject.entries()).map(async ([projectId, {ids, keys}]) => {
                try {
                    const response = await axios.post(
                        `${getAgentaApiUrl()}/preview/testcases/query`,
                        {testcase_ids: ids},
                        {params: {project_id: projectId}},
                    )
                    const testcases = response.data?.testcases ?? []
                    const byId = new Map<string, FlattenedTestcase>()

                    testcases.forEach((tc: unknown) => {
                        try {
                            const validated = testcaseSchema.parse(tc)
                            const flattened = flattenTestcase(validated)
                            if (flattened.id) {
                                byId.set(flattened.id, flattened)
                            }
                        } catch (e) {
                            console.error("[testcaseBatchFetcher] Validation error:", e)
                        }
                    })

                    ids.forEach((id, idx) => {
                        results.set(keys[idx], byId.get(id) ?? null)
                    })
                } catch (error) {
                    console.error("[testcaseBatchFetcher] Fetch error:", error)
                    keys.forEach((key) => results.set(key, null))
                }
            }),
        )

        return results
    },
    resolveResult: (response, _request, serializedKey) => {
        return response.get(serializedKey) ?? null
    },
    maxBatchSize: 100,
})

/**
 * Find single testcase in paginated cache
 */
const findInPaginatedCache = (
    queryClient: import("@tanstack/react-query").QueryClient,
    _projectId: string,
    revisionId: string,
    testcaseId: string,
): FlattenedTestcase | undefined => {
    const scopeId = `testcases-${revisionId}`
    const queries = queryClient.getQueriesData<PaginatedCachePage>({
        queryKey: ["testcase-paginated", scopeId],
    })

    for (const [_queryKey, data] of queries) {
        if (data?.rows) {
            const found = data.rows.find((row) => row.id === testcaseId)
            if (found) return found
        }
    }

    return undefined
}

// ============================================================================
// QUERY ATOM FAMILY
// ============================================================================

/**
 * Query atom family for fetching a single testcase
 *
 * Uses cache redirect + batch fetcher for optimal performance.
 * For local entities (IDs starting with "new-"), the query is disabled
 * and returns a stable "not found" state since they don't exist on server.
 */
export const testcaseQueryAtomFamily = atomFamily((testcaseId: string) =>
    atomWithQuery((get) => {
        const projectId = get(projectIdAtom)
        const revisionId = get(currentRevisionIdAtom)
        const queryClient = get(queryClientAtom)

        // Local entities (new-*) don't exist on server - skip query entirely
        const isLocalEntity = testcaseId.startsWith("new-")

        const cachedData =
            !isLocalEntity && projectId && revisionId && testcaseId
                ? findInPaginatedCache(queryClient, projectId, revisionId, testcaseId)
                : undefined

        return {
            queryKey: ["testcase", projectId, testcaseId],
            queryFn: async (): Promise<FlattenedTestcase | null> => {
                // Local entities never fetch - data comes from draft atom
                if (isLocalEntity || !projectId || !testcaseId) return null
                return testcaseBatchFetcher({
                    projectId,
                    testcaseId,
                    queryClient,
                    revisionId: revisionId ?? undefined,
                })
            },
            initialData: cachedData ?? undefined,
            // Disable query for local entities - they only exist in draft state
            enabled: Boolean(!isLocalEntity && projectId && testcaseId && !cachedData),
            staleTime: Infinity,
            gcTime: Infinity,
        }
    }),
)

// ============================================================================
// DRAFT STATE
// ============================================================================

/**
 * Create draft state using shared factory
 */
const testcaseDraftState = createEntityDraftState<FlattenedTestcase, FlattenedTestcase>({
    entityAtomFamily: (id: string) => {
        const queryAtom = testcaseQueryAtomFamily(id)
        return atom((get) => get(queryAtom).data ?? null)
    },
    getDraftableData: (testcase) => testcase,
    mergeDraft: (testcase, draft) => ({...testcase, ...draft}),
    isDirty: (currentData, originalData, {get, id}) => {
        const draft = get(testcaseDraftAtomFamily(id))
        const queryState = get(testcaseQueryAtomFamily(id))
        const serverState = queryState.data ?? null

        // Check pending column changes
        if (!draft && serverState) {
            const serverRecord = serverState as Record<string, unknown>
            const pendingRenames = get(pendingColumnRenamesAtom)
            const pendingDeleted = get(pendingDeletedColumnsAtom)
            const pendingAdded = get(pendingAddedColumnsAtom)

            for (const oldKey of pendingRenames.keys()) {
                if (oldKey in serverRecord) return true
            }
            for (const columnKey of pendingDeleted) {
                if (columnKey in serverRecord) {
                    const value = serverRecord[columnKey]
                    if (value !== undefined && value !== null && value !== "") return true
                }
            }
            for (const columnKey of pendingAdded) {
                if (!(columnKey in serverRecord)) return true
            }
            return false
        }

        if (!draft) return false
        if (!serverState) {
            for (const [key, value] of Object.entries(draft)) {
                if (SYSTEM_FIELDS.has(key)) continue
                if (value !== undefined && value !== null && value !== "") return true
            }
            return false
        }

        const draftRecord = currentData as Record<string, unknown>
        const serverRecord = originalData as Record<string, unknown>

        for (const key of Object.keys(draftRecord)) {
            if (SYSTEM_FIELDS.has(key)) continue
            if (!(key in serverRecord)) return true
            const normalizedDraft = normalizeValueForComparison(draftRecord[key])
            const normalizedServer = normalizeValueForComparison(serverRecord[key])
            if (normalizedDraft !== normalizedServer) return true
        }

        for (const key of Object.keys(serverRecord)) {
            if (SYSTEM_FIELDS.has(key)) continue
            if (!(key in draftRecord)) {
                const serverValue = serverRecord[key]
                if (serverValue !== undefined && serverValue !== null && serverValue !== "") {
                    return true
                }
            }
        }

        return false
    },
    excludeFields: SYSTEM_FIELDS,
})

export const testcaseDraftAtomFamily = testcaseDraftState.draftAtomFamily
export const testcaseHasDraftAtomFamily = testcaseDraftState.hasDraftAtomFamily
export const testcaseIsDirtyAtomFamily = testcaseDraftState.isDirtyAtomFamily
export const discardDraftAtom = testcaseDraftState.discardDraftAtom

// ============================================================================
// ENTITY ATOM (COMBINED)
// ============================================================================

/**
 * Apply pending column changes to a testcase
 */
const applyPendingColumnChanges = (
    data: FlattenedTestcase,
    renames: Map<string, string>,
    deletedColumns: Set<string>,
    addedColumns: Set<string>,
): FlattenedTestcase => {
    if (renames.size === 0 && deletedColumns.size === 0 && addedColumns.size === 0) {
        return data
    }

    const result = {...data} as Record<string, unknown>
    let hasChanges = false

    for (const [oldKey, newKey] of renames.entries()) {
        if (oldKey in result && !(newKey in result)) {
            result[newKey] = result[oldKey]
            delete result[oldKey]
            hasChanges = true
        }
    }

    for (const columnKey of deletedColumns) {
        if (columnKey in result) {
            delete result[columnKey]
            hasChanges = true
        }
    }

    for (const columnKey of addedColumns) {
        if (!(columnKey in result)) {
            result[columnKey] = ""
            hasChanges = true
        }
    }

    return hasChanges ? (result as FlattenedTestcase) : data
}

/**
 * Combined entity atom: draft if exists, otherwise server data with column changes
 */
export const testcaseEntityAtomFamily = atomFamily((testcaseId: string) =>
    atom((get): FlattenedTestcase | null => {
        const draft = get(testcaseDraftAtomFamily(testcaseId))
        if (draft) return draft

        const query = get(testcaseQueryAtomFamily(testcaseId))
        const data = query.data ?? null

        if (data) {
            const pendingRenames = get(pendingColumnRenamesAtom)
            const pendingDeleted = get(pendingDeletedColumnsAtom)
            const pendingAdded = get(pendingAddedColumnsAtom)
            if (pendingRenames.size > 0 || pendingDeleted.size > 0 || pendingAdded.size > 0) {
                return applyPendingColumnChanges(data, pendingRenames, pendingDeleted, pendingAdded)
            }
        }

        return data
    }),
)

// ============================================================================
// CELL ACCESSOR
// ============================================================================

const cellValueEquals = (a: unknown, b: unknown): boolean => {
    if (a === b) return true
    if (a === undefined || a === null || b === undefined || b === null) return a === b
    if (typeof a !== typeof b) return false
    if (typeof a === "string") return a === b
    if (typeof a === "object") {
        try {
            return JSON.stringify(a) === JSON.stringify(b)
        } catch {
            return false
        }
    }
    return a === b
}

/**
 * Cell accessor atom family for fine-grained table cell subscriptions
 */
export const testcaseCellAtomFamily = atomFamily(
    ({id, column}: {id: string; column: string}) => {
        return selectAtom(
            testcaseEntityAtomFamily(id),
            (entity) => {
                if (!entity) return undefined

                // Try direct key access first (handles flat keys with dots)
                const directValue = (entity as Record<string, unknown>)[column]
                if (directValue !== undefined) return directValue

                // Handle nested paths
                const parts = column.split(".")
                if (parts.length === 1) {
                    return get(entity, column)
                }

                let current: unknown = entity
                for (let i = 0; i < parts.length; i++) {
                    const part = parts[i]
                    current = (current as Record<string, unknown>)?.[part]

                    if (i < parts.length - 1 && typeof current === "string") {
                        const trimmed = current.trim()
                        if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
                            try {
                                current = JSON.parse(trimmed)
                            } catch {
                                return undefined
                            }
                        } else {
                            return undefined
                        }
                    }
                }

                return current
            },
            cellValueEquals,
        )
    },
    (a, b) => a.id === b.id && a.column === b.column,
)

// ============================================================================
// MUTATIONS
// ============================================================================

/**
 * Check if updated data matches original server data
 */
const updatedMatchesOriginal = (
    updated: FlattenedTestcase,
    serverState: FlattenedTestcase | null,
): boolean => {
    if (!serverState) return false

    const updatedRecord = updated as Record<string, unknown>
    const serverRecord = serverState as Record<string, unknown>

    for (const key of Object.keys(updatedRecord)) {
        if (SYSTEM_FIELDS.has(key)) continue
        if (!(key in serverRecord)) {
            const value = updatedRecord[key]
            if (value !== undefined && value !== null && value !== "") return false
            continue
        }
        const normalizedUpdated = normalizeValueForComparison(updatedRecord[key])
        const normalizedServer = normalizeValueForComparison(serverRecord[key])
        if (normalizedUpdated !== normalizedServer) return false
    }

    for (const key of Object.keys(serverRecord)) {
        if (SYSTEM_FIELDS.has(key)) continue
        if (!(key in updatedRecord)) {
            const serverValue = serverRecord[key]
            if (serverValue !== undefined && serverValue !== null && serverValue !== "") {
                return false
            }
        }
    }

    return true
}

/**
 * Update a testcase field
 */
export const updateTestcaseAtom = atom(
    null,
    (get, set, id: string, updates: Partial<FlattenedTestcase>) => {
        const current = get(testcaseEntityAtomFamily(id))
        if (!current) return

        const updated = {...current}
        for (const [key, value] of Object.entries(updates)) {
            if (value === undefined) {
                delete updated[key]
            } else {
                updated[key] = value
            }
        }

        const queryState = get(testcaseQueryAtomFamily(id))
        const serverState = queryState.data ?? null

        if (serverState && updatedMatchesOriginal(updated, serverState)) {
            set(testcaseDraftAtomFamily(id), null)
            return
        }

        set(testcaseDraftAtomFamily(id), updated)
    },
)

/**
 * Discard all drafts
 */
export const discardAllDraftsAtom = atom(null, (get, set) => {
    const ids = get(testcaseIdsAtom)
    const newIds = get(newEntityIdsAtom)
    ;[...ids, ...newIds].forEach((id) => {
        set(testcaseDraftAtomFamily(id), null)
    })
})

/**
 * Batch update multiple testcases
 */
export const batchUpdateTestcasesSyncAtom = atom(
    null,
    (get, set, updates: {id: string; updates: Partial<FlattenedTestcase>}[]) => {
        const queryClient = get(queryClientAtom)
        const projectId = get(projectIdAtom)
        const revisionId = get(currentRevisionIdAtom)
        const draftsToSet: {id: string; data: FlattenedTestcase}[] = []

        for (const {id, updates: entityUpdates} of updates) {
            let current: FlattenedTestcase | null = get(testcaseDraftAtomFamily(id))

            if (!current && projectId && revisionId) {
                current = findInPaginatedCache(queryClient, projectId, revisionId, id) ?? null
            }

            if (!current) {
                current = get(testcaseEntityAtomFamily(id))
            }

            if (!current) continue

            const updated = {...current, ...entityUpdates}
            for (const [key, value] of Object.entries(entityUpdates)) {
                if (value === undefined) {
                    delete (updated as Record<string, unknown>)[key]
                }
            }
            draftsToSet.push({id, data: updated})
        }

        for (const {id, data} of draftsToSet) {
            set(testcaseDraftAtomFamily(id), data)
        }
    },
)

// ============================================================================
// COLUMN OPERATIONS (BATCH)
// ============================================================================

/**
 * Rename a column across all testcases
 */
export const renameColumnInTestcasesAtom = atom(
    null,
    (
        get,
        set,
        {
            oldKey,
            newKey,
            rowDataMap,
        }: {oldKey: string; newKey: string; rowDataMap?: Map<string, Record<string, unknown>>},
    ) => {
        const ids = get(testcaseIdsAtom)
        const newIds = get(newEntityIdsAtom)
        const allIds = [...ids, ...newIds]
        const updates: {id: string; updates: Partial<FlattenedTestcase>}[] = []

        for (const id of allIds) {
            const draft = get(testcaseDraftAtomFamily(id))
            if (draft) {
                const record = draft as Record<string, unknown>
                if (oldKey in record) {
                    updates.push({
                        id,
                        updates: {
                            [newKey]: record[oldKey],
                            [oldKey]: undefined,
                        } as Partial<FlattenedTestcase>,
                    })
                }
                continue
            }

            if (rowDataMap) {
                const rowData = rowDataMap.get(id)
                if (rowData && oldKey in rowData) {
                    updates.push({
                        id,
                        updates: {
                            [newKey]: rowData[oldKey],
                            [oldKey]: undefined,
                        } as Partial<FlattenedTestcase>,
                    })
                }
            }
        }

        set(batchUpdateTestcasesSyncAtom, updates)
    },
)

/**
 * Delete a column from all testcases
 */
export const deleteColumnFromTestcasesAtom = atom(null, (get, set, columnKey: string) => {
    const ids = get(testcaseIdsAtom)
    const newIds = get(newEntityIdsAtom)
    const allIds = [...ids, ...newIds]
    const updates: {id: string; updates: Partial<FlattenedTestcase>}[] = []

    for (const id of allIds) {
        const entity = get(testcaseEntityAtomFamily(id))
        if (!entity) continue

        const record = entity as Record<string, unknown>

        if (columnKey.includes(".")) {
            // Handle nested column deletion
            const parts = columnKey.split(".")
            const rootKey = parts[0]

            if (rootKey in record && record[rootKey] != null) {
                let rootValue = record[rootKey]
                let isJsonString = false

                if (typeof rootValue === "string") {
                    try {
                        const parsed = JSON.parse(rootValue)
                        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
                            rootValue = parsed
                            isJsonString = true
                        }
                    } catch {
                        continue
                    }
                }

                if (typeof rootValue === "object" && !Array.isArray(rootValue)) {
                    const clonedRoot = JSON.parse(JSON.stringify(rootValue))
                    let current: Record<string, unknown> = clonedRoot

                    for (let i = 1; i < parts.length - 1; i++) {
                        if (current && typeof current === "object" && parts[i] in current) {
                            current = current[parts[i]] as Record<string, unknown>
                        } else {
                            break
                        }
                    }

                    if (current && typeof current === "object") {
                        const finalKey = parts[parts.length - 1]
                        if (finalKey in current) {
                            delete current[finalKey]

                            if (Object.keys(clonedRoot).length === 0) {
                                updates.push({
                                    id,
                                    updates: {[rootKey]: undefined} as Partial<FlattenedTestcase>,
                                })
                            } else {
                                const updatedValue = isJsonString
                                    ? JSON.stringify(clonedRoot)
                                    : clonedRoot
                                updates.push({
                                    id,
                                    updates: {
                                        [rootKey]: updatedValue,
                                    } as Partial<FlattenedTestcase>,
                                })
                            }
                        }
                    }
                }
            }
        } else if (columnKey in record) {
            updates.push({id, updates: {[columnKey]: undefined} as Partial<FlattenedTestcase>})
        }
    }

    set(batchUpdateTestcasesSyncAtom, updates)
})

/**
 * Add a column to all testcases
 */
export const addColumnToTestcasesAtom = atom(
    null,
    (get, set, {columnKey, defaultValue = ""}: {columnKey: string; defaultValue?: unknown}) => {
        const ids = get(testcaseIdsAtom)
        const newIds = get(newEntityIdsAtom)
        const allIds = [...ids, ...newIds]
        const updates: {id: string; updates: Partial<FlattenedTestcase>}[] = []

        for (const id of allIds) {
            const entity = get(testcaseEntityAtomFamily(id))
            if (!entity) continue

            const record = entity as Record<string, unknown>
            if (!(columnKey in record)) {
                updates.push({
                    id,
                    updates: {[columnKey]: defaultValue} as Partial<FlattenedTestcase>,
                })
            }
        }

        set(batchUpdateTestcasesSyncAtom, updates)
    },
)
