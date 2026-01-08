import {atom, getDefaultStore} from "jotai"
import {atomFamily} from "jotai/utils"
import {atomWithQuery, queryClientAtom} from "jotai-tanstack-query"

import axios from "@/oss/lib/api/assets/axiosConfig"
import {getAgentaApiUrl} from "@/oss/lib/helpers/api"
import {projectIdAtom} from "@/oss/state/project/selectors/project"

import {createEntityDraftState} from "../shared/createEntityDraftState"

import {
    revisionSchema,
    testsetSchema,
    variantSchema,
    type Revision,
    type RevisionsResponse,
    type Testset,
    type TestsetsResponse,
    type Variant,
} from "./revisionSchema"

// ============================================================================
// SPECIAL TESTSET ID FOR NEW TESTSETS
// ============================================================================

/**
 * Special testset ID used for new testsets that haven't been saved yet
 */
export const NEW_TESTSET_ID = "new"

/**
 * Check if a testset ID represents a new (unsaved) testset
 */
export const isNewTestsetId = (id: string | null | undefined): boolean => {
    return id === NEW_TESTSET_ID
}

/**
 * List params for fetching revisions
 */
export interface RevisionListParams {
    projectId: string
    testsetId: string
}

/**
 * Detail params for fetching a single revision
 */
export interface RevisionDetailParams {
    id: string
    projectId: string
}

/**
 * List params for fetching testsets
 */
export interface TestsetListParams {
    projectId: string
    searchQuery?: string | null
}

/**
 * Detail params for fetching a single testset
 */
export interface TestsetDetailParams {
    id: string
    projectId: string
}

/**
 * Detail params for fetching a single variant
 */
export interface VariantDetailParams {
    id: string
    projectId: string
}

// ============================================================================
// API FUNCTIONS (exported for use in other modules)
// ============================================================================

/**
 * Fetch a single revision by ID
 */
export async function fetchRevision({id, projectId}: RevisionDetailParams): Promise<Revision> {
    const response = await axios.get(`${getAgentaApiUrl()}/preview/testsets/revisions/${id}`, {
        params: {project_id: projectId, include_testcases: false},
    })
    return revisionSchema.parse(response.data?.testset_revision ?? response.data)
}

/**
 * Fetch revisions list for a testset
 */
export async function fetchRevisionsList({
    projectId,
    testsetId,
}: RevisionListParams): Promise<RevisionsResponse> {
    const response = await axios.post(
        `${getAgentaApiUrl()}/preview/testsets/revisions/query`,
        {
            testset_refs: [{id: testsetId}],
            windowing: {limit: 100, order: "descending"},
            include_testcases: false,
        },
        {params: {project_id: projectId}},
    )
    return {
        testset_revisions: response.data?.testset_revisions ?? [],
        count: response.data?.count,
        windowing: response.data?.windowing,
    }
}

/**
 * Fetch testsets list (metadata only)
 */
export async function fetchTestsetsList({
    projectId,
    searchQuery = null,
}: TestsetListParams): Promise<TestsetsResponse> {
    if (!projectId) {
        return {testsets: [], count: 0}
    }
    const queryPayload: Record<string, unknown> = {
        windowing: {limit: 100, order: "descending"},
    }

    if (searchQuery && searchQuery.trim()) {
        queryPayload.testset = {
            name: searchQuery.trim(),
        }
    }

    const response = await axios.post(`${getAgentaApiUrl()}/preview/testsets/query`, queryPayload, {
        params: {project_id: projectId},
    })

    return {
        testsets: response.data?.testsets ?? [],
        count: response.data?.count,
    }
}

/**
 * Fetch a single testset by ID (metadata only)
 */
export async function fetchTestsetDetail({id, projectId}: TestsetDetailParams): Promise<Testset> {
    const response = await axios.get(`${getAgentaApiUrl()}/preview/testsets/${id}`, {
        params: {project_id: projectId},
    })
    return testsetSchema.parse(response.data?.testset ?? response.data)
}

/**
 * Fetch a single variant by ID (contains name and description)
 */
export async function fetchVariantDetail({id, projectId}: VariantDetailParams): Promise<Variant> {
    const response = await axios.get(`${getAgentaApiUrl()}/preview/testsets/variants/${id}`, {
        params: {project_id: projectId},
    })
    return variantSchema.parse(response.data?.testset_variant ?? response.data)
}

// ============================================================================
// CACHE REDIRECT HELPERS
// Look up entities in list query cache before fetching
// ============================================================================

/**
 * Find a testset in the list query cache
 */
const findTestsetInCache = (
    queryClient: import("@tanstack/react-query").QueryClient,
    testsetId: string,
): Testset | undefined => {
    // Check testsets-list cache
    const queries = queryClient.getQueriesData({queryKey: ["testsets-list"]})

    for (const [_queryKey, data] of queries) {
        if (!data || typeof data !== "object") continue

        // Check if response has testsets array
        const testsets = (data as any)?.testsets
        if (Array.isArray(testsets)) {
            const found = testsets.find((t: any) => t?.id === testsetId)
            if (found) {
                try {
                    return testsetSchema.parse(found)
                } catch {
                    continue
                }
            }
        }
    }

    return undefined
}

/**
 * Find a variant in various query caches
 */
const findVariantInCache = (
    queryClient: import("@tanstack/react-query").QueryClient,
    variantId: string,
): Variant | undefined => {
    // Check variant cache
    const queries = queryClient.getQueriesData({queryKey: ["variant"]})

    for (const [_queryKey, data] of queries) {
        if (!data || typeof data !== "object") continue
        if ((data as any)?.id === variantId) {
            try {
                return variantSchema.parse(data)
            } catch {
                continue
            }
        }
    }

    return undefined
}

// ============================================================================
// TESTSET QUERY ATOM FAMILY
// Fetches individual testset metadata with cache redirect
// ============================================================================

/**
 * Create a mock testset for new (unsaved) testsets
 * This allows the entity to be immediately available for draft editing
 */
const createMockTestset = (): Testset => ({
    id: NEW_TESTSET_ID,
    name: "",
    description: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
})

/**
 * Query atom for fetching a single testset
 * Uses cache redirect to check list cache first
 * For "new" testset, provides mock testset as initialData (synchronously available)
 */
export const testsetQueryAtomFamily = atomFamily(
    (testsetId: string) =>
        atomWithQuery<Testset | null>((get) => {
            const projectId = get(projectIdAtom)
            const queryClient = get(queryClientAtom)

            // For "new" testset (not yet saved), use mock testset as initialData
            const isNew = isNewTestsetId(testsetId)

            // Create mock testset for new testsets (synchronously available)
            const mockTestset = isNew ? createMockTestset() : undefined

            // Try to find in list cache first (only for real testsets)
            const cachedData =
                testsetId && !isNew ? findTestsetInCache(queryClient, testsetId) : undefined

            return {
                queryKey: ["testset", projectId, testsetId],
                queryFn: async () => {
                    if (!projectId || !testsetId) return null
                    if (isNew) {
                        // Return mock testset for new (unsaved) testsets
                        return createMockTestset()
                    }
                    return fetchTestsetDetail({id: testsetId, projectId})
                },
                // For new testsets, mock is immediately available as initialData
                initialData: cachedData ?? mockTestset ?? undefined,
                // Disable query for new testsets (we have initialData) and for cached data
                enabled: Boolean(projectId && testsetId && !cachedData && !isNew),
                staleTime: isNew ? Infinity : 60_000,
                gcTime: isNew ? Infinity : 5 * 60_000,
            }
        }),
    (a, b) => a === b,
)

/**
 * Base testset entity atom - extracts data from query (server data only)
 * Used as base for draft state
 * Also exported as serverData selector for reading server state without draft
 */
export const testsetServerDataAtomFamily = atomFamily(
    (testsetId: string) =>
        atom((get) => {
            const query = get(testsetQueryAtomFamily(testsetId))
            return query.data ?? null
        }),
    (a, b) => a === b,
)

// ============================================================================
// TESTSET DRAFT STATE
// Allows editing testset metadata (name, description) locally
// ============================================================================

/**
 * Testset draft state - manages local edits to testset metadata
 * Uses the shared entity draft state pattern
 */
export const testsetDraftState = createEntityDraftState<Testset, Testset>({
    entityAtomFamily: testsetServerDataAtomFamily,
    getDraftableData: (entity) => entity,
    mergeDraft: (entity, draft) => ({...entity, ...draft}),
    excludeFields: new Set(["id", "created_at", "updated_at"]),
})

/**
 * Testset entity atom - server data merged with local draft
 * External code should use testset.selectors.data instead.
 */
export const testsetEntityAtomFamily = testsetDraftState.withDraftAtomFamily

/**
 * Check if testset has local draft edits
 */
export const testsetHasDraftAtomFamily = testsetDraftState.hasDraftAtomFamily

/**
 * Check if testset is dirty (draft differs from server)
 */
export const testsetIsDirtyAtomFamily = testsetDraftState.isDirtyAtomFamily

/**
 * Update testset draft (name, description)
 */
export const updateTestsetDraftAtom = testsetDraftState.updateAtom

/**
 * Discard testset draft
 */
export const discardTestsetDraftAtom = testsetDraftState.discardDraftAtom

// ============================================================================
// TESTSETS LIST QUERY ATOM
// Fetches list of testsets for a project
// ============================================================================

/**
 * Query atom for fetching testsets list
 */
export const testsetsListQueryAtomFamily = atomFamily(
    (searchQuery: string | null) =>
        atomWithQuery<TestsetsResponse>((get) => {
            const projectId = get(projectIdAtom)

            return {
                queryKey: ["testsets-list", projectId, searchQuery ?? ""],
                queryFn: async () => {
                    if (!projectId) return {testsets: [], count: 0}
                    return fetchTestsetsList({projectId, searchQuery})
                },
                enabled: Boolean(projectId),
                staleTime: 60_000,
                gcTime: 5 * 60_000,
            }
        }),
    (a, b) => a === b,
)

/**
 * Invalidate the testsets list cache.
 * Call this after creating/updating/deleting a testset to refresh the list.
 */
export const invalidateTestsetsListCache = () => {
    const store = getDefaultStore()
    const queryClient = store.get(queryClientAtom)
    queryClient.invalidateQueries({queryKey: ["testsets-list"]})
}

/**
 * Invalidate a specific testset's cache.
 * Call this after updating testset metadata (name/description) to refresh the entity.
 */
export const invalidateTestsetCache = (testsetId: string) => {
    const store = getDefaultStore()
    const queryClient = store.get(queryClientAtom)
    queryClient.invalidateQueries({
        queryKey: ["testset"],
        predicate: (query) => {
            // Match queries like ["testset", projectId, testsetId]
            return query.queryKey[0] === "testset" && query.queryKey[2] === testsetId
        },
    })
}

/**
 * Invalidate the revisions list cache for a specific testset.
 * Call this after deleting a revision to refresh the revisions dropdown.
 */
export const invalidateRevisionsListCache = (testsetId: string) => {
    const store = getDefaultStore()
    const queryClient = store.get(queryClientAtom)
    queryClient.invalidateQueries({
        queryKey: ["revisions-list"],
        predicate: (query) => {
            // Match queries like ["revisions-list", projectId, testsetId]
            return query.queryKey[0] === "revisions-list" && query.queryKey[2] === testsetId
        },
    })
}

// ============================================================================
// VARIANT QUERY ATOM FAMILY
// Fetches individual variant data with cache redirect
// ============================================================================

/**
 * Query atom for fetching a single variant
 */
export const variantQueryAtomFamily = atomFamily(
    (variantId: string) =>
        atomWithQuery<Variant | null>((get) => {
            const projectId = get(projectIdAtom)
            const queryClient = get(queryClientAtom)

            // Try to find in cache first
            const cachedData = variantId ? findVariantInCache(queryClient, variantId) : undefined

            return {
                queryKey: ["variant", projectId, variantId],
                queryFn: async () => {
                    if (!projectId || !variantId) return null
                    return fetchVariantDetail({id: variantId, projectId})
                },
                initialData: cachedData ?? undefined,
                enabled: Boolean(projectId && variantId && !cachedData),
                staleTime: 60_000,
                gcTime: 5 * 60_000,
            }
        }),
    (a, b) => a === b,
)

/**
 * Variant entity atom - extracts data from query (single source of truth)
 * (Variants don't have draft state)
 */
export const variantEntityAtomFamily = atomFamily(
    (variantId: string) =>
        atom((get) => {
            const query = get(variantQueryAtomFamily(variantId))
            return query.data ?? null
        }),
    (a, b) => a === b,
)
