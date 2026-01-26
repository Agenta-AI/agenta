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

import {axios, getAgentaApiUrl} from "@agenta/shared/api"
import {projectIdAtom} from "@agenta/shared/state"
import {createBatchFetcher, isValidUUID} from "@agenta/shared/utils"
import {atom, type PrimitiveAtom} from "jotai"
import {selectAtom} from "jotai/utils"
import {atomFamily} from "jotai-family"
import {atomWithQuery, queryClientAtom} from "jotai-tanstack-query"
import get from "lodash/get"

import {createEntityDraftState, normalizeValueForComparison} from "../../shared"
import {pendingColumnOpsAtomFamily} from "../../testset/state/revisionTableState"
import {testcaseSchema, SYSTEM_FIELDS, type Testcase} from "../core"

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

/**
 * Look up a testcase in the individual testcase query cache.
 * This is populated by fetchTestcasesPage when it stores each testcase.
 */
const findInTestcaseCache = (
    queryClient: import("@tanstack/react-query").QueryClient,
    projectId: string,
    testcaseId: string,
): Testcase | undefined => {
    return queryClient.getQueryData<Testcase>(["testcase", projectId, testcaseId])
}

/**
 * Look up multiple testcases in the query cache
 */
const findMultipleInCache = (
    queryClient: import("@tanstack/react-query").QueryClient,
    projectId: string,
    testcaseIds: string[],
): Map<string, Testcase> => {
    const found = new Map<string, Testcase>()

    for (const testcaseId of testcaseIds) {
        const cached = findInTestcaseCache(queryClient, projectId, testcaseId)
        if (cached) {
            found.set(testcaseId, cached)
        }
    }

    return found
}

/**
 * Batch fetcher that combines concurrent requests.
 * Returns Testcase (nested format) - cell values accessed via testcase.data[columnKey].
 */
const testcaseBatchFetcher = createBatchFetcher<
    TestcaseRequest,
    Testcase | null,
    Map<string, Testcase | null>
>({
    serializeKey: ({projectId, testcaseId}) => `${projectId}:${testcaseId}`,
    batchFn: async (requests, serializedKeys) => {
        const results = new Map<string, Testcase | null>()

        // Check cache first (grouped by project for efficiency)
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
            if (req.queryClient && req.projectId && req.testcaseId && isValidUUID(req.testcaseId)) {
                const groupKey = req.projectId
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
        for (const [projectId, {queryClient, testcaseIds, keyMap}] of cacheCheckGroups) {
            const found = findMultipleInCache(queryClient, projectId, testcaseIds)
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
                    const byId = new Map<string, Testcase>()

                    testcases.forEach((tc: unknown) => {
                        try {
                            const validated = testcaseSchema.parse(tc)
                            if (validated.id) {
                                byId.set(validated.id, validated)
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

// ============================================================================
// QUERY ATOM FAMILY
// ============================================================================

/**
 * Query atom family for fetching a single testcase.
 * Returns Testcase (nested format) - cell values accessed via testcase.data[columnKey].
 *
 * Uses cache redirect + batch fetcher for optimal performance.
 * For local entities (IDs starting with "new-"), the query is disabled
 * and returns a stable "not found" state since they don't exist on server.
 */
export const testcaseQueryAtomFamily = atomFamily((testcaseId: string) =>
    atomWithQuery((get) => {
        const projectId = get(projectIdAtom)
        const queryClient = get(queryClientAtom)

        // Local entities (new-*) don't exist on server - skip query entirely
        const isLocalEntity = testcaseId.startsWith("new-")

        // Check cache for existing data
        const cachedData =
            !isLocalEntity && projectId && testcaseId
                ? findInTestcaseCache(queryClient, projectId, testcaseId)
                : undefined

        return {
            queryKey: ["testcase", projectId, testcaseId],
            queryFn: async (): Promise<Testcase | null> => {
                // Local entities never fetch - data comes from draft atom
                if (isLocalEntity || !projectId || !testcaseId) return null
                return testcaseBatchFetcher({
                    projectId,
                    testcaseId,
                    queryClient,
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
 * Create draft state using shared factory.
 * Works with Testcase (nested format) - data fields are in testcase.data.
 */
const testcaseDraftState = createEntityDraftState<Testcase, Testcase>({
    entityAtomFamily: (id: string) => {
        const queryAtom = testcaseQueryAtomFamily(id)
        return atom((get) => get(queryAtom).data ?? null)
    },
    getDraftableData: (testcase) => testcase,
    mergeDraft: (testcase, draft) => ({
        ...testcase,
        ...draft,
        data: {...(testcase.data ?? {}), ...(draft.data ?? {})},
    }),
    isDirty: (currentData, originalData, {get, id}) => {
        const draft = get(testcaseDraftAtomFamily(id))
        const queryState = get(testcaseQueryAtomFamily(id))
        const serverState = queryState.data ?? null

        // Check pending column changes (operate on .data)
        if (!draft && serverState) {
            const serverData = serverState.data ?? {}
            const pendingRenames = get(pendingColumnRenamesAtom)
            const pendingDeleted = get(pendingDeletedColumnsAtom)
            const pendingAdded = get(pendingAddedColumnsAtom)

            for (const oldKey of pendingRenames.keys()) {
                if (oldKey in serverData) return true
            }
            for (const columnKey of pendingDeleted) {
                if (columnKey in serverData) {
                    const value = serverData[columnKey]
                    if (value !== undefined && value !== null && value !== "") return true
                }
            }
            for (const columnKey of pendingAdded) {
                if (!(columnKey in serverData)) return true
            }
            return false
        }

        if (!draft) return false
        if (!serverState) {
            // New entity - check if data has any non-empty values
            const draftData = draft.data ?? {}
            for (const [key, value] of Object.entries(draftData)) {
                if (SYSTEM_FIELDS.has(key)) continue
                if (value !== undefined && value !== null && value !== "") return true
            }
            return false
        }

        // Compare data fields
        const draftData = currentData.data ?? {}
        const serverData = originalData.data ?? {}

        for (const key of Object.keys(draftData)) {
            if (SYSTEM_FIELDS.has(key)) continue
            if (!(key in serverData)) return true
            const normalizedDraft = normalizeValueForComparison(draftData[key])
            const normalizedServer = normalizeValueForComparison(serverData[key])
            if (normalizedDraft !== normalizedServer) return true
        }

        for (const key of Object.keys(serverData)) {
            if (SYSTEM_FIELDS.has(key)) continue
            if (!(key in draftData)) {
                const serverValue = serverData[key]
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
 * Apply pending column changes to a testcase's data field.
 * Returns Testcase with modified data property.
 */
const applyPendingColumnChanges = (
    testcase: Testcase,
    renames: Map<string, string>,
    deletedColumns: Set<string>,
    addedColumns: Set<string>,
): Testcase => {
    if (renames.size === 0 && deletedColumns.size === 0 && addedColumns.size === 0) {
        return testcase
    }

    const dataRecord = {...(testcase.data ?? {})}
    let hasChanges = false

    for (const [oldKey, newKey] of renames.entries()) {
        if (oldKey in dataRecord && !(newKey in dataRecord)) {
            dataRecord[newKey] = dataRecord[oldKey]
            delete dataRecord[oldKey]
            hasChanges = true
        }
    }

    for (const columnKey of deletedColumns) {
        if (columnKey in dataRecord) {
            delete dataRecord[columnKey]
            hasChanges = true
        }
    }

    for (const columnKey of addedColumns) {
        if (!(columnKey in dataRecord)) {
            dataRecord[columnKey] = ""
            hasChanges = true
        }
    }

    return hasChanges ? {...testcase, data: dataRecord} : testcase
}

/**
 * Combined entity atom: draft if exists, otherwise server data with column changes.
 * Returns Testcase (nested format) - cell values accessed via testcase.data[columnKey].
 */
export const testcaseEntityAtomFamily = atomFamily((testcaseId: string) =>
    atom((get): Testcase | null => {
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
 * Cell accessor atom family for fine-grained table cell subscriptions.
 *
 * Reads from entity.data for column values, supporting:
 * - Direct keys: "country" -> entity.data.country
 * - Nested paths: "inputs.prompt" -> entity.data.inputs.prompt
 * - JSON string parsing for nested object values
 */
export const testcaseCellAtomFamily = atomFamily(
    ({id, column}: {id: string; column: string}) => {
        return selectAtom(
            testcaseEntityAtomFamily(id),
            (entity) => {
                if (!entity) return undefined

                // Access data from the nested `data` property
                const data = entity.data ?? {}

                // Try direct key access first (handles flat keys with dots)
                const directValue = data[column]
                if (directValue !== undefined) return directValue

                // Handle nested paths within data (e.g., "inputs.prompt")
                const parts = column.split(".")
                if (parts.length === 1) {
                    return get(data, column)
                }

                let current: unknown = data
                for (let i = 0; i < parts.length; i++) {
                    const part = parts[i]
                    current = (current as Record<string, unknown>)?.[part]

                    // Handle JSON string values that need parsing
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
 * Check if updated data matches original server data.
 * Compares the `data` property of Testcase objects.
 */
const updatedMatchesOriginal = (updated: Testcase, serverState: Testcase | null): boolean => {
    if (!serverState) return false

    const updatedData = updated.data ?? {}
    const serverData = serverState.data ?? {}

    for (const key of Object.keys(updatedData)) {
        if (SYSTEM_FIELDS.has(key)) continue
        if (!(key in serverData)) {
            const value = updatedData[key]
            if (value !== undefined && value !== null && value !== "") return false
            continue
        }
        const normalizedUpdated = normalizeValueForComparison(updatedData[key])
        const normalizedServer = normalizeValueForComparison(serverData[key])
        if (normalizedUpdated !== normalizedServer) return false
    }

    for (const key of Object.keys(serverData)) {
        if (SYSTEM_FIELDS.has(key)) continue
        if (!(key in updatedData)) {
            const serverValue = serverData[key]
            if (serverValue !== undefined && serverValue !== null && serverValue !== "") {
                return false
            }
        }
    }

    return true
}

/**
 * Update payload type for testcase updates.
 * Can update data fields (goes into testcase.data) or system fields.
 */
export type TestcaseUpdatePayload = Partial<Testcase> & {
    /** Data field updates (merged into testcase.data) */
    data?: Record<string, unknown>
}

/**
 * Update a testcase field.
 * Updates are applied to the `data` property of the Testcase.
 */
export const updateTestcaseAtom = atom(
    null,
    (get, set, id: string, updates: TestcaseUpdatePayload) => {
        const current = get(testcaseEntityAtomFamily(id))
        if (!current) return

        // Merge updates - data fields go into testcase.data
        const updated: Testcase = {
            ...current,
            ...updates,
            data: {
                ...(current.data ?? {}),
                ...(updates.data ?? {}),
            },
        }

        // Handle undefined values in data (delete them)
        if (updates.data) {
            for (const [key, value] of Object.entries(updates.data)) {
                if (value === undefined) {
                    delete updated.data![key]
                }
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
 * Batch update multiple testcases.
 * Updates are applied to the `data` property of each Testcase.
 */
export const batchUpdateTestcasesSyncAtom = atom(
    null,
    (get, set, updates: {id: string; updates: TestcaseUpdatePayload}[]) => {
        const queryClient = get(queryClientAtom)
        const projectId = get(projectIdAtom)
        const draftsToSet: {id: string; data: Testcase}[] = []

        for (const {id, updates: entityUpdates} of updates) {
            let current: Testcase | null = get(testcaseDraftAtomFamily(id))

            // Check cache if no draft
            if (!current && projectId) {
                current = findInTestcaseCache(queryClient, projectId, id) ?? null
            }

            if (!current) {
                current = get(testcaseEntityAtomFamily(id))
            }

            if (!current) continue

            // Merge updates into data
            const updatedData = {...(current.data ?? {}), ...(entityUpdates.data ?? {})}
            for (const [key, value] of Object.entries(entityUpdates.data ?? {})) {
                if (value === undefined) {
                    delete updatedData[key]
                }
            }

            const updated: Testcase = {
                ...current,
                ...entityUpdates,
                data: updatedData,
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
 * Rename a column across all testcases.
 * Operates on the `data` property of each Testcase.
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
        const updates: {id: string; updates: TestcaseUpdatePayload}[] = []

        for (const id of allIds) {
            const draft = get(testcaseDraftAtomFamily(id))
            if (draft) {
                const dataRecord = draft.data ?? {}
                if (oldKey in dataRecord) {
                    updates.push({
                        id,
                        updates: {
                            data: {
                                [newKey]: dataRecord[oldKey],
                                [oldKey]: undefined,
                            },
                        },
                    })
                }
                continue
            }

            // Check rowDataMap for server data
            if (rowDataMap) {
                const rowData = rowDataMap.get(id)
                if (rowData && oldKey in rowData) {
                    updates.push({
                        id,
                        updates: {
                            data: {
                                [newKey]: rowData[oldKey],
                                [oldKey]: undefined,
                            },
                        },
                    })
                }
            }
        }

        set(batchUpdateTestcasesSyncAtom, updates)
    },
)

/**
 * Delete a column from all testcases.
 * Operates on the `data` property of each Testcase.
 */
export const deleteColumnFromTestcasesAtom = atom(null, (get, set, columnKey: string) => {
    const ids = get(testcaseIdsAtom)
    const newIds = get(newEntityIdsAtom)
    const allIds = [...ids, ...newIds]
    const updates: {id: string; updates: TestcaseUpdatePayload}[] = []

    for (const id of allIds) {
        const entity = get(testcaseEntityAtomFamily(id))
        if (!entity) continue

        const dataRecord = entity.data ?? {}

        if (columnKey.includes(".")) {
            // Handle nested column deletion
            const parts = columnKey.split(".")
            const rootKey = parts[0]

            if (rootKey in dataRecord && dataRecord[rootKey] != null) {
                let rootValue = dataRecord[rootKey]
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
                                    updates: {data: {[rootKey]: undefined}},
                                })
                            } else {
                                const updatedValue = isJsonString
                                    ? JSON.stringify(clonedRoot)
                                    : clonedRoot
                                updates.push({
                                    id,
                                    updates: {data: {[rootKey]: updatedValue}},
                                })
                            }
                        }
                    }
                }
            }
        } else if (columnKey in dataRecord) {
            updates.push({id, updates: {data: {[columnKey]: undefined}}})
        }
    }

    set(batchUpdateTestcasesSyncAtom, updates)
})

/**
 * Add a column to all testcases.
 * Operates on the `data` property of each Testcase.
 */
export const addColumnToTestcasesAtom = atom(
    null,
    (get, set, {columnKey, defaultValue = ""}: {columnKey: string; defaultValue?: unknown}) => {
        const ids = get(testcaseIdsAtom)
        const newIds = get(newEntityIdsAtom)
        const allIds = [...ids, ...newIds]
        const updates: {id: string; updates: TestcaseUpdatePayload}[] = []

        for (const id of allIds) {
            const entity = get(testcaseEntityAtomFamily(id))
            if (!entity) continue

            const dataRecord = entity.data ?? {}
            if (!(columnKey in dataRecord)) {
                updates.push({
                    id,
                    updates: {data: {[columnKey]: defaultValue}},
                })
            }
        }

        set(batchUpdateTestcasesSyncAtom, updates)
    },
)
