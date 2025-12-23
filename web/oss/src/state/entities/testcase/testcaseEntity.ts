import {atom} from "jotai"
import {atomFamily} from "jotai/utils"
import {atomWithQuery, queryClientAtom} from "jotai-tanstack-query"

import axios from "@/oss/lib/api/assets/axiosConfig"
import {getAgentaApiUrl} from "@/oss/lib/helpers/api"
import {projectIdAtom} from "@/oss/state/project/selectors/project"
import createBatchFetcher from "@/oss/state/utils/createBatchFetcher"

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
// ============================================================================

interface TestcaseRequest {
    projectId: string
    testcaseId: string
}

/**
 * Check if a string is a valid UUID (new rows have temp IDs like "new-row-xxx")
 */
const isValidUUID = (id: string): boolean => {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    return uuidRegex.test(id)
}

/**
 * Batch fetcher that combines concurrent testcase requests into a single API call
 */
const testcaseBatchFetcher = createBatchFetcher<
    TestcaseRequest,
    FlattenedTestcase | null,
    Map<string, FlattenedTestcase | null>
>({
    serializeKey: ({projectId, testcaseId}) => `${projectId}:${testcaseId}`,
    batchFn: async (requests, serializedKeys) => {
        const results = new Map<string, FlattenedTestcase | null>()

        // Group by projectId
        const byProject = new Map<string, {ids: string[]; keys: string[]}>()
        requests.forEach((req, idx) => {
            const key = serializedKeys[idx]
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

        // Fetch each project's testcases in batch
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
// PAGINATED CACHE LOOKUP
// Helper to find testcase in datasetStore's TanStack Query cache
// ============================================================================

interface DatasetStorePage {
    rows: FlattenedTestcase[]
    totalCount: number
    nextCursor: string | null
    hasMore: boolean
}

/**
 * Look up a testcase in the datasetStore's paginated query cache
 * Returns the testcase if found, undefined otherwise
 *
 * The datasetStore uses query keys like:
 * ["testcases-table", scopeId, cursor, limit, offset, windowing.next, windowing.stop, metaKey]
 */
const findInPaginatedCache = (
    queryClient: ReturnType<
        (typeof import("@tanstack/react-query").QueryClient)["prototype"]["getQueryData"]
    > extends (...args: infer _A) => infer _R
        ? import("@tanstack/react-query").QueryClient
        : never,
    _projectId: string,
    _revisionId: string,
    testcaseId: string,
): FlattenedTestcase | undefined => {
    // Get all queries that match the testcases-table key prefix
    const queries = queryClient.getQueriesData<DatasetStorePage>({
        queryKey: ["testcases-table"],
    })

    // Search through all cached pages for the testcase
    for (const [_queryKey, data] of queries) {
        if (data?.rows) {
            const found = data.rows.find((row) => row.id === testcaseId)
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
                return testcaseBatchFetcher({projectId, testcaseId})
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
// LOCAL DRAFT STATE ATOM FAMILY
// Stores local edits for each testcase (null = no local edits)
// ============================================================================

/**
 * Local draft state for each testcase
 * null = no local edits, use server state
 * FlattenedTestcase = local edits exist
 */
export const testcaseDraftAtomFamily = atomFamily((testcaseId: string) =>
    atom<FlattenedTestcase | null>(null),
)

// ============================================================================
// COMBINED ENTITY ATOM FAMILY
// Combines query (server state) + draft (local edits)
// Reads draft if exists, otherwise reads from query
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

/**
 * Check if entity has local edits (draft exists)
 */
export const testcaseHasDraftAtomFamily = atomFamily((testcaseId: string) =>
    atom((get): boolean => {
        const draft = get(testcaseDraftAtomFamily(testcaseId))
        return draft !== null
    }),
)

/**
 * Get server state for a testcase (for dirty comparison)
 */
export const testcaseServerStateAtomFamily = atomFamily((testcaseId: string) =>
    atom((get): FlattenedTestcase | null => {
        const query = get(testcaseQueryAtomFamily(testcaseId))
        return query.data ?? null
    }),
)

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
 * Check if a testcase is dirty by comparing draft vs server state
 * Returns true if:
 * - Draft exists AND differs from server state
 * - OR pending column changes would affect server data (no draft yet but changes pending)
 */
export const testcaseIsDirtyAtomFamily = atomFamily((testcaseId: string) =>
    atom((get): boolean => {
        const draft = get(testcaseDraftAtomFamily(testcaseId))
        const serverState = get(testcaseServerStateAtomFamily(testcaseId))

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
        const draftRecord = draft as Record<string, unknown>
        const serverRecord = serverState as Record<string, unknown>

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
            // Normalize: undefined/null/"" are equivalent for comparison
            const normalizedDraft = draftValue ?? ""
            const normalizedServer = serverValue ?? ""
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
    }),
)

// ============================================================================
// ENTITY MUTATIONS
// ============================================================================

/**
 * Update a testcase field (creates draft if needed)
 * Keys with undefined values are deleted from the entity
 */
export const updateTestcaseAtom = atom(
    null,
    (get, set, {id, updates}: {id: string; updates: Partial<FlattenedTestcase>}) => {
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
export const discardDraftAtom = atom(null, (get, set, id: string) => {
    set(testcaseDraftAtomFamily(id), null)
})

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

        for (const {id, updates: entityUpdates} of updates) {
            const current = get(testcaseEntityAtomFamily(id))
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
    (get, set, {oldKey, newKey}: {oldKey: string; newKey: string}) => {
        const ids = get(testcaseIdsAtom)
        const newIds = get(newEntityIdsAtom)
        const allIds = [...ids, ...newIds]

        const updates: {id: string; updates: Partial<FlattenedTestcase>}[] = []

        for (const id of allIds) {
            const entity = get(testcaseEntityAtomFamily(id))
            if (!entity) continue

            const record = entity as Record<string, unknown>
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
        if (columnKey in record) {
            updates.push({
                id,
                updates: {
                    [columnKey]: undefined,
                } as Partial<FlattenedTestcase>,
            })
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
// ============================================================================

/**
 * Read a specific cell value from a testcase
 */
export const testcaseCellAtomFamily = atomFamily(
    ({id, column}: {id: string; column: string}) =>
        atom((get) => {
            const entity = get(testcaseEntityAtomFamily(id))
            if (!entity) return undefined
            return (entity as Record<string, unknown>)[column]
        }),
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
atomFamilyRegistry.testcaseServerState = testcaseServerStateAtomFamily
atomFamilyRegistry.testcaseIsDirty = testcaseIsDirtyAtomFamily
atomFamilyRegistry.testcaseCell = testcaseCellAtomFamily
