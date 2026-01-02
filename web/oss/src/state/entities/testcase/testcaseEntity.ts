import {atom} from "jotai"
import {atomFamily, selectAtom} from "jotai/utils"
import {atomWithQuery, queryClientAtom} from "jotai-tanstack-query"
import {get} from "lodash"

import axios from "@/oss/lib/api/assets/axiosConfig"
import {getAgentaApiUrl} from "@/oss/lib/helpers/api"
import {projectIdAtom} from "@/oss/state/project/selectors/project"
import createBatchFetcher from "@/oss/state/utils/createBatchFetcher"

import {
    createEntityDraftState,
    normalizeValueForComparison,
} from "../shared/createEntityDraftState"

import {atomFamilyRegistry} from "./atomCleanup"
import {
    pendingAddedColumnsAtom,
    pendingColumnRenamesAtom,
    pendingDeletedColumnsAtom,
} from "./columnState"
import {currentRevisionIdAtom} from "./queries"
import {flattenTestcase, testcaseSchema, type FlattenedTestcase} from "./schema"

// ============================================================================
// TESTCASE IDS ATOM
// Settable list of testcase IDs - populated by paginated query
// ============================================================================

/**
 * List of testcase IDs to display
 * Accumulated by paginated query as pages load
 */
export const testcaseIdsAtom = atom<string[]>([])

/**
 * Append testcase IDs (called by fetchData when paginated data arrives)
 * Appends new IDs to existing list to support infinite scroll
 */
export const setTestcaseIdsAtom = atom(null, (get, set, ids: string[]) => {
    const existing = get(testcaseIdsAtom)
    const existingSet = new Set(existing)
    const newIds = ids.filter((id) => !existingSet.has(id))
    if (newIds.length > 0) {
        set(testcaseIdsAtom, [...existing, ...newIds])
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
    set(newEntityIdsBaseAtom, (prev) => [...prev, id])
})

export const removeNewEntityIdAtom = atom(null, (get, set, id: string) => {
    set(newEntityIdsBaseAtom, (prev) => prev.filter((i) => i !== id))
})

export const clearNewEntityIdsAtom = atom(null, (get, set) => {
    set(newEntityIdsBaseAtom, [])
})

// ============================================================================
// DELETED ENTITY IDS (soft deleted, pending save)
// ============================================================================

const deletedEntityIdsBaseAtom = atom<Set<string>>(new Set<string>())
export const deletedEntityIdsAtom = atom((get) => get(deletedEntityIdsBaseAtom))

export const markDeletedAtom = atom(null, (get, set, id: string) => {
    set(deletedEntityIdsBaseAtom, (prev: Set<string>) => new Set([...prev, id]))
})

export const unmarkDeletedAtom = atom(null, (get, set, id: string) => {
    set(deletedEntityIdsBaseAtom, (prev: Set<string>) => {
        const next = new Set(prev)
        next.delete(id)
        return next
    })
})

export const clearDeletedIdsAtom = atom(null, (get, set) => {
    set(deletedEntityIdsBaseAtom, new Set())
})

// ============================================================================
// BATCH FETCHER FOR TESTCASES
// Collects concurrent single-testcase requests and batches them
// Checks paginated cache first to avoid redundant API calls
// ============================================================================

interface TestcaseRequest {
    projectId: string
    testcaseId: string
    /** Optional: queryClient for cache lookup */
    queryClient?: import("@tanstack/react-query").QueryClient
    /** Optional: revisionId for scoped cache lookup */
    revisionId?: string
}

/**
 * Check if a string is a valid UUID (new rows have temp IDs like "new-row-xxx")
 */
const isValidUUID = (id: string): boolean => {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    return uuidRegex.test(id)
}

/**
 * Page structure from the paginated store cache
 */
interface PaginatedCachePage {
    rows: FlattenedTestcase[]
    totalCount: number
    nextCursor: string | null
    hasMore: boolean
}

/**
 * Look up testcases in the paginated cache
 * Returns a map of testcaseId -> FlattenedTestcase for found items
 */
const findMultipleInPaginatedCache = (
    queryClient: import("@tanstack/react-query").QueryClient,
    revisionId: string,
    testcaseIds: string[],
): Map<string, FlattenedTestcase> => {
    const found = new Map<string, FlattenedTestcase>()
    const idsToFind = new Set(testcaseIds)

    // Build scopeId to narrow down the search
    const scopeId = `testcases-${revisionId}`

    // Get all queries that match the testcase-paginated key prefix with this scopeId
    const queries = queryClient.getQueriesData<PaginatedCachePage>({
        queryKey: ["testcase-paginated", scopeId],
    })

    // Search through all cached pages for the testcases
    for (const [_queryKey, data] of queries) {
        if (data?.rows && idsToFind.size > 0) {
            for (const row of data.rows) {
                if (row.id && idsToFind.has(row.id)) {
                    found.set(row.id, row)
                    idsToFind.delete(row.id)
                    // Early exit if we found everything
                    if (idsToFind.size === 0) break
                }
            }
        }
        if (idsToFind.size === 0) break
    }

    return found
}

/**
 * Batch fetcher that combines concurrent testcase requests into a single API call
 * Checks paginated cache first to avoid fetching data that's already available
 */
const testcaseBatchFetcher = createBatchFetcher<
    TestcaseRequest,
    FlattenedTestcase | null,
    Map<string, FlattenedTestcase | null>
>({
    serializeKey: ({projectId, testcaseId}) => `${projectId}:${testcaseId}`,
    batchFn: async (requests, serializedKeys) => {
        const results = new Map<string, FlattenedTestcase | null>()

        // First pass: check paginated cache for all requests that have queryClient
        // Group requests by revisionId for efficient cache lookup
        const cacheCheckGroups = new Map<
            string,
            {queryClient: import("@tanstack/react-query").QueryClient; testcaseIds: string[]; keyMap: Map<string, string>}
        >()

        requests.forEach((req, idx) => {
            const key = serializedKeys[idx]
            if (req.queryClient && req.revisionId && req.testcaseId && isValidUUID(req.testcaseId)) {
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

        // Look up all items in cache
        const cachedItems = new Map<string, FlattenedTestcase>()
        for (const [revisionId, {queryClient, testcaseIds, keyMap}] of cacheCheckGroups) {
            const found = findMultipleInPaginatedCache(queryClient, revisionId, testcaseIds)
            for (const [testcaseId, testcase] of found) {
                const serializedKey = keyMap.get(testcaseId)
                if (serializedKey) {
                    results.set(serializedKey, testcase)
                    cachedItems.set(testcaseId, testcase)
                }
            }
        }

        // Second pass: group remaining (non-cached) requests by projectId
        const byProject = new Map<string, {ids: string[]; keys: string[]}>()
        requests.forEach((req, idx) => {
            const key = serializedKeys[idx]

            // Skip if already resolved from cache
            if (results.has(key)) return

            // Skip invalid requests or non-UUID IDs (new rows have temp IDs)
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

        // Fetch each project's testcases in batch (only those not in cache)
        await Promise.all(
            Array.from(byProject.entries()).map(async ([projectId, {ids, keys}]) => {
                try {
                    const response = await axios.post(
                        `${getAgentaApiUrl()}/preview/testcases/query`,
                        {testcase_ids: ids},
                        {params: {project_id: projectId}},
                    )
                    const testcases = response.data?.testcases ?? []

                    // Map results by ID
                    const byId = new Map<string, FlattenedTestcase>()
                    testcases.forEach((tc: unknown, tcIdx: number) => {
                        try {
                            const validated = testcaseSchema.parse(tc)
                            const flattened = flattenTestcase(validated)
                            if (flattened.id) {
                                byId.set(flattened.id, flattened)
                            }
                        } catch (validationError) {
                            // Log validation errors for debugging
                            console.error(
                                `[testcaseBatchFetcher] Failed to validate testcase at index ${tcIdx}:`,
                                validationError instanceof Error
                                    ? validationError.message
                                    : validationError,
                                {testcase: tc},
                            )
                        }
                    })

                    // Resolve each request
                    ids.forEach((id, idx) => {
                        const key = keys[idx]
                        results.set(key, byId.get(id) ?? null)
                    })
                } catch (error) {
                    // Log batch fetch errors for debugging
                    console.error(
                        `[testcaseBatchFetcher] Failed to fetch testcases for project ${projectId}:`,
                        error instanceof Error ? error.message : String(error),
                        {projectId, testcaseIds: ids, error},
                    )
                    // Set null for all failed requests
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

// ============================================================================
// PAGINATED CACHE LOOKUP (SINGLE ITEM)
// Helper to find a single testcase in datasetStore's TanStack Query cache
// ============================================================================

/**
 * Look up a testcase in the datasetStore's paginated query cache
 * Returns the testcase if found, undefined otherwise
 *
 * The paginated store uses query keys like:
 * ["testcase-paginated", scopeId, cursor, limit, offset, windowing.next, windowing.stop, metaKey]
 *
 * Where scopeId = "testcases-{revisionId}"
 */
const findInPaginatedCache = (
    queryClient: import("@tanstack/react-query").QueryClient,
    _projectId: string,
    revisionId: string,
    testcaseId: string,
): FlattenedTestcase | undefined => {
    // Build scopeId to narrow down the search to the correct revision
    const scopeId = `testcases-${revisionId}`

    // Get all queries that match the testcase-paginated key prefix with this scopeId
    const queries = queryClient.getQueriesData<PaginatedCachePage>({
        queryKey: ["testcase-paginated", scopeId],
    })

    // Search through all cached pages for the testcase
    for (const [_queryKey, data] of queries) {
        if (data?.rows) {
            const found = data.rows.find((row: FlattenedTestcase) => row.id === testcaseId)
            if (found) {
                return found
            }
        }
    }

    return undefined
}

// ============================================================================
// SINGLE TESTCASE QUERY ATOM FAMILY
// Fetches a single testcase by ID - uses cache redirect + batch fetcher
// ============================================================================

/**
 * Query atom family for fetching a single testcase
 *
 * Cache redirect strategy:
 * 1. First check paginated query cache for the testcase
 * 2. If found, use as initialData (no fetch needed)
 * 3. If not found, use batch fetcher to combine concurrent requests
 *
 * This provides the "server state" for each entity
 */
export const testcaseQueryAtomFamily = atomFamily((testcaseId: string) =>
    atomWithQuery((get) => {
        const projectId = get(projectIdAtom)
        const revisionId = get(currentRevisionIdAtom)
        const queryClient = get(queryClientAtom)

        // Try to find in paginated cache
        const cachedData =
            projectId && revisionId && testcaseId
                ? findInPaginatedCache(queryClient, projectId, revisionId, testcaseId)
                : undefined

        return {
            queryKey: ["testcase", projectId, testcaseId],
            queryFn: async (): Promise<FlattenedTestcase | null> => {
                if (!projectId || !testcaseId) return null
                // Pass queryClient and revisionId for cache lookup in batch fetcher
                return testcaseBatchFetcher({
                    projectId,
                    testcaseId,
                    queryClient,
                    revisionId: revisionId ?? undefined,
                })
            },
            // Use cached data as initial data - prevents fetch if already in paginated cache
            initialData: cachedData ?? undefined,
            // Only fetch if not in cache
            enabled: Boolean(projectId && testcaseId && !cachedData),
            // Testcases are immutable - never stale, never gc
            staleTime: Infinity,
            gcTime: Infinity,
        }
    }),
)

// ============================================================================
// DRAFT STATE MANAGEMENT
// Uses shared factory for draft state with testcase-specific configuration
// ============================================================================

/**
 * System fields to exclude from dirty comparison
 */
const DIRTY_EXCLUDE_FIELDS = new Set([
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
])

/**
 * Create draft state management for testcases
 * Uses shared factory with testcase-specific dirty detection
 */
const testcaseDraftState = createEntityDraftState<FlattenedTestcase, FlattenedTestcase>({
    // Read from testcase query atoms (server state)
    entityAtomFamily: (id: string) => {
        const queryAtom = testcaseQueryAtomFamily(id)
        return atom((get) => get(queryAtom).data ?? null)
    },

    // Entire testcase is draftable
    getDraftableData: (testcase) => testcase,

    // Merge draft over testcase
    mergeDraft: (testcase, draft) => ({...testcase, ...draft}),

    // Complex dirty detection logic with pending column changes
    isDirty: (currentData, originalData, {get, id}) => {
        const draft = get(testcaseDraftAtomFamily(id))
        // Use query atom directly (single source of truth for server data)
        const queryState = get(testcaseQueryAtomFamily(id))
        const serverState = queryState.data ?? null

        // Check if pending column changes affect this entity (even without draft)
        if (!draft && serverState) {
            const serverRecord = serverState as Record<string, unknown>

            // Check pending renames
            const pendingRenames = get(pendingColumnRenamesAtom)
            for (const oldKey of pendingRenames.keys()) {
                if (oldKey in serverRecord) {
                    return true // Server has old column that needs renaming
                }
            }

            // Check pending deletions
            const pendingDeleted = get(pendingDeletedColumnsAtom)
            for (const columnKey of pendingDeleted) {
                if (columnKey in serverRecord) {
                    const value = serverRecord[columnKey]
                    if (value !== undefined && value !== null && value !== "") {
                        return true // Server has column with data that needs deleting
                    }
                }
            }

            // Check pending additions (server doesn't have the column yet)
            const pendingAdded = get(pendingAddedColumnsAtom)
            for (const columnKey of pendingAdded) {
                if (!(columnKey in serverRecord)) {
                    return true // Server doesn't have this added column
                }
            }

            return false
        }

        if (!draft) return false // No draft and no pending changes = not dirty

        if (!serverState) {
            // New entity (no server state) - dirty if has any data
            for (const [key, value] of Object.entries(draft)) {
                if (DIRTY_EXCLUDE_FIELDS.has(key)) continue
                if (value !== undefined && value !== null && value !== "") {
                    return true
                }
            }
            return false
        }

        // Compare draft vs server state field by field
        const draftRecord = currentData as Record<string, unknown>
        const serverRecord = originalData as Record<string, unknown>

        // Check draft keys against server
        for (const key of Object.keys(draftRecord)) {
            if (DIRTY_EXCLUDE_FIELDS.has(key)) continue

            // Check if this is a new column (draft has it, server doesn't)
            if (!(key in serverRecord)) {
                // Draft has a key that server doesn't have - this is an added column
                return true
            }

            const draftValue = draftRecord[key]
            const serverValue = serverRecord[key]
            // Normalize values for comparison - handles object vs string JSON comparison
            const normalizedDraft = normalizeValueForComparison(draftValue)
            const normalizedServer = normalizeValueForComparison(serverValue)
            if (normalizedDraft !== normalizedServer) {
                return true
            }
        }

        // Check server keys not in draft (deleted columns)
        for (const key of Object.keys(serverRecord)) {
            if (DIRTY_EXCLUDE_FIELDS.has(key)) continue
            if (!(key in draftRecord)) {
                // Server has key that draft doesn't - check if server value is non-empty
                const serverValue = serverRecord[key]
                if (serverValue !== undefined && serverValue !== null && serverValue !== "") {
                    return true
                }
            }
        }

        return false
    },

    excludeFields: DIRTY_EXCLUDE_FIELDS,
})

// Export atoms with original names for backward compatibility
export const testcaseDraftAtomFamily = testcaseDraftState.draftAtomFamily
export const testcaseHasDraftAtomFamily = testcaseDraftState.hasDraftAtomFamily
export const testcaseIsDirtyAtomFamily = testcaseDraftState.isDirtyAtomFamily

// Note: updateTestcaseAtom and discardDraftAtom are exported later after entity atom definition

// ============================================================================
// COMBINED ENTITY ATOM FAMILY
// Combines query (server state) + draft (local edits) + pending column changes
// Reads draft if exists, otherwise reads from query with column changes applied
// ============================================================================

/**
 * Apply pending column changes to a testcase
 * Used when server data is loaded after column operations
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

    // Apply renames
    for (const [oldKey, newKey] of renames.entries()) {
        if (oldKey in result && !(newKey in result)) {
            result[newKey] = result[oldKey]
            delete result[oldKey]
            hasChanges = true
        }
    }

    // Apply deletions (remove column from data)
    for (const columnKey of deletedColumns) {
        if (columnKey in result) {
            delete result[columnKey]
            hasChanges = true
        }
    }

    // Apply additions (add empty column)
    for (const columnKey of addedColumns) {
        if (!(columnKey in result)) {
            result[columnKey] = ""
            hasChanges = true
        }
    }

    return hasChanges ? (result as FlattenedTestcase) : data
}

/**
 * Combined entity atom: returns draft if exists, otherwise server data
 * Applies pending column changes to server data for consistency
 * This is the main read atom for testcase data
 */
export const testcaseEntityAtomFamily = atomFamily((testcaseId: string) =>
    atom((get): FlattenedTestcase | null => {
        // Check for local draft first
        const draft = get(testcaseDraftAtomFamily(testcaseId))
        if (draft) {
            return draft
        }

        // Fall back to server data from query
        const query = get(testcaseQueryAtomFamily(testcaseId))
        const data = query.data ?? null

        // Apply pending column changes to server data
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
// ENTITY MUTATIONS
// ============================================================================

/**
 * Update a testcase field (creates draft if needed)
 * Keys with undefined values are deleted from the entity
 *
 * Signature: (id: string, updates: Partial<FlattenedTestcase>) => void
 * This matches the standard entity controller pattern.
 */
export const updateTestcaseAtom = atom(
    null,
    (get, set, id: string, updates: Partial<FlattenedTestcase>) => {
        const current = get(testcaseEntityAtomFamily(id))
        if (!current) return

        // Start with current data
        const updated = {...current}

        // Apply updates - undefined values delete the key
        for (const [key, value] of Object.entries(updates)) {
            if (value === undefined) {
                delete updated[key]
            } else {
                updated[key] = value
            }
        }

        set(testcaseDraftAtomFamily(id), updated)
    },
)

/**
 * Discard local edits for a testcase
 */
export const discardDraftAtom = testcaseDraftState.discardDraftAtom

/**
 * Discard all local drafts
 */
export const discardAllDraftsAtom = atom(null, (get, set) => {
    const ids = get(testcaseIdsAtom)
    const newIds = get(newEntityIdsAtom)
    ;[...ids, ...newIds].forEach((id) => {
        set(testcaseDraftAtomFamily(id), null)
    })
})

// ============================================================================
// BATCH UPDATES
// Uses synchronous batch updates to avoid N re-renders
// ============================================================================

/**
 * Batch update multiple testcases
 * Keys with undefined values are deleted from the entity
 * Jotai automatically batches synchronous sets in the same tick
 */
export const batchUpdateTestcasesSyncAtom = atom(
    null,
    (get, set, updates: {id: string; updates: Partial<FlattenedTestcase>}[]) => {
        // Collect all updates first
        const draftsToSet: {id: string; data: FlattenedTestcase}[] = []
        const queryClient = get(queryClientAtom)
        const projectId = get(projectIdAtom)
        const revisionId = get(currentRevisionIdAtom)

        for (const {id, updates: entityUpdates} of updates) {
            // First check for existing draft
            let current: FlattenedTestcase | null = get(testcaseDraftAtomFamily(id))

            // If no draft, try to get from paginated cache directly
            // This avoids atomWithQuery subscription issues in write functions
            if (!current && projectId && revisionId) {
                current = findInPaginatedCache(queryClient, projectId, revisionId, id) ?? null
            }

            // Fall back to entity atom (which may trigger query)
            if (!current) {
                current = get(testcaseEntityAtomFamily(id))
            }

            if (!current) continue

            // Merge updates, then delete keys that are explicitly set to undefined
            const updated = {...current, ...entityUpdates}
            for (const [key, value] of Object.entries(entityUpdates)) {
                if (value === undefined) {
                    delete (updated as Record<string, unknown>)[key]
                }
            }
            draftsToSet.push({id, data: updated})
        }

        // Apply all updates - Jotai batches synchronous sets in the same tick
        for (const {id, data} of draftsToSet) {
            set(testcaseDraftAtomFamily(id), data)
        }
    },
)

/**
 * Rename a column across all testcases
 * Uses batch update to avoid N re-renders
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
            // First check if there's a draft
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

            // For server rows without draft, use the provided rowDataMap
            // This contains the actual row data from the datasetStore
            if (rowDataMap) {
                const rowData = rowDataMap.get(id)
                if (rowData) {
                    const record = rowData as Record<string, unknown>
                    if (oldKey in record) {
                        updates.push({
                            id,
                            updates: {
                                [newKey]: record[oldKey],
                                [oldKey]: undefined,
                            } as Partial<FlattenedTestcase>,
                        })
                    }
                }
            }
        }

        // Use sync batch update
        set(batchUpdateTestcasesSyncAtom, updates)
    },
)

/**
 * Remove a column from all testcases (set value to undefined)
 * Uses batch update to avoid N re-renders
 * Note: This is optional - deleteColumnAtom just hides the column without removing data
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

        // Handle nested column keys (e.g., "inputs.code", "current_rfp.event")
        if (columnKey.includes(".")) {
            const parts = columnKey.split(".")
            const rootKey = parts[0]

            // Check if root exists
            if (rootKey in record && record[rootKey] != null) {
                let rootValue = record[rootKey]
                let isJsonString = false

                // Parse if it's a JSON string
                if (typeof rootValue === "string") {
                    try {
                        const parsed = JSON.parse(rootValue)
                        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
                            rootValue = parsed
                            isJsonString = true
                        }
                    } catch {
                        // Not valid JSON, skip this entity
                        continue
                    }
                }

                // Now rootValue should be an object
                if (typeof rootValue === "object" && !Array.isArray(rootValue)) {
                    // Clone to avoid mutation
                    const clonedRoot = JSON.parse(JSON.stringify(rootValue))

                    // Navigate to the parent of the property to delete
                    let current: any = clonedRoot
                    for (let i = 1; i < parts.length - 1; i++) {
                        if (current && typeof current === "object" && parts[i] in current) {
                            current = current[parts[i]]
                        } else {
                            current = null
                            break
                        }
                    }

                    // Delete the final property
                    if (current && typeof current === "object") {
                        const finalKey = parts[parts.length - 1]
                        if (finalKey in current) {
                            delete current[finalKey]

                            // Check if the root object is now empty (no properties left)
                            const hasRemainingProperties = Object.keys(clonedRoot).length > 0

                            if (!hasRemainingProperties) {
                                // Remove the entire parent key if empty
                                updates.push({
                                    id,
                                    updates: {
                                        [rootKey]: undefined,
                                    } as Partial<FlattenedTestcase>,
                                })
                            } else {
                                // Convert back to JSON string if needed
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
        } else {
            // Simple top-level column
            if (columnKey in record) {
                updates.push({
                    id,
                    updates: {
                        [columnKey]: undefined,
                    } as Partial<FlattenedTestcase>,
                })
            }
        }
    }

    // Use sync batch update
    set(batchUpdateTestcasesSyncAtom, updates)
})

/**
 * Add a column to all testcases with a default value
 * Uses batch update to avoid N re-renders
 * Note: This is optional - addColumnAtom just adds column metadata, entities get value on edit
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
            // Only add if column doesn't exist
            if (!(columnKey in record)) {
                updates.push({
                    id,
                    updates: {
                        [columnKey]: defaultValue,
                    } as Partial<FlattenedTestcase>,
                })
            }
        }

        // Use sync batch update
        set(batchUpdateTestcasesSyncAtom, updates)
    },
)

// ============================================================================
// CELL ACCESSOR
// Optimized atom for reading a single cell value
// Uses selectAtom for fine-grained subscriptions - only re-renders when
// the specific cell value changes, not when other fields change
// ============================================================================

/**
 * Equality check for cell values
 * Handles primitives and simple object comparison
 */
const cellValueEquals = (a: unknown, b: unknown): boolean => {
    if (a === b) return true
    if (a === undefined || a === null || b === undefined || b === null) return a === b
    if (typeof a !== typeof b) return false
    // For strings, compare directly (most common case)
    if (typeof a === "string") return a === b
    // For objects, do shallow JSON comparison (handles most cases)
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
 * Read a specific cell value from a testcase
 * Uses selectAtom with equality check to prevent re-renders when value hasn't changed
 */
export const testcaseCellAtomFamily = atomFamily(
    ({id, column}: {id: string; column: string}) => {
        // Use selectAtom for fine-grained subscriptions
        // Only re-renders when the specific column value changes
        return selectAtom(
            testcaseEntityAtomFamily(id),
            (entity) => {
                if (!entity) {
                    return undefined
                }

                // Handle nested paths (e.g., "VMs_previous_RFP.event")
                // We need to parse JSON strings for nested access
                const parts = column.split(".")

                if (parts.length === 1) {
                    // Simple top-level access
                    return get(entity, column)
                }

                // Nested path - need to parse JSON strings along the way
                let current: any = entity
                for (let i = 0; i < parts.length; i++) {
                    const part = parts[i]
                    current = current?.[part]

                    // If we got a JSON string and there are more parts to traverse, parse it
                    if (i < parts.length - 1 && typeof current === "string") {
                        const trimmed = current.trim()
                        if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
                            try {
                                current = JSON.parse(trimmed)
                            } catch {
                                return undefined
                            }
                        } else {
                            // String but not JSON - can't traverse further
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
// REGISTER ATOM FAMILIES FOR CLEANUP
// Allows atomCleanup.ts to clean up atoms when switching revisions
// ============================================================================

// Register all atomFamily instances for cleanup
atomFamilyRegistry.testcaseQuery = testcaseQueryAtomFamily
atomFamilyRegistry.testcaseDraft = testcaseDraftAtomFamily
atomFamilyRegistry.testcaseEntity = testcaseEntityAtomFamily
atomFamilyRegistry.testcaseHasDraft = testcaseHasDraftAtomFamily
atomFamilyRegistry.testcaseIsDirty = testcaseIsDirtyAtomFamily
atomFamilyRegistry.testcaseCell = testcaseCellAtomFamily
