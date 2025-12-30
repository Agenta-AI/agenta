import {atom, getDefaultStore} from "jotai"
import {atomFamily} from "jotai/utils"
import {atomWithQuery, queryClientAtom} from "jotai-tanstack-query"

import axios from "@/oss/lib/api/assets/axiosConfig"
import {getAgentaApiUrl} from "@/oss/lib/helpers/api"
import {projectIdAtom} from "@/oss/state/project/selectors/project"

import {createEntityStore} from "../core/createEntityStore"

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
 * Query atom for fetching a single testset
 * Uses cache redirect to check list cache first
 */
export const testsetQueryAtomFamily = atomFamily(
    (testsetId: string) =>
        atomWithQuery<Testset | null>((get) => {
            const projectId = get(projectIdAtom)
            const queryClient = get(queryClientAtom)

            // Try to find in list cache first
            const cachedData = testsetId ? findTestsetInCache(queryClient, testsetId) : undefined

            return {
                queryKey: ["testset", projectId, testsetId],
                queryFn: async () => {
                    if (!projectId || !testsetId) return null
                    return fetchTestsetDetail({id: testsetId, projectId})
                },
                initialData: cachedData ?? undefined,
                enabled: Boolean(projectId && testsetId && !cachedData),
                staleTime: 60_000,
                gcTime: 5 * 60_000,
            }
        }),
    (a, b) => a === b,
)

/**
 * Server state atom - returns raw testset data from query
 */
export const testsetServerStateAtomFamily = atomFamily(
    (testsetId: string) =>
        atom((get) => {
            const query = get(testsetQueryAtomFamily(testsetId))
            return query.data ?? null
        }),
    (a, b) => a === b,
)

/**
 * Testset entity atom - for read-only metadata, same as server state
 * (Testsets don't have draft state - edits create new revisions)
 */
export const testsetEntityAtomFamily = testsetServerStateAtomFamily

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
 * Server state atom - returns raw variant data from query
 */
export const variantServerStateAtomFamily = atomFamily(
    (variantId: string) =>
        atom((get) => {
            const query = get(variantQueryAtomFamily(variantId))
            return query.data ?? null
        }),
    (a, b) => a === b,
)

/**
 * Variant entity atom - for read-only data, same as server state
 */
export const variantEntityAtomFamily = variantServerStateAtomFamily

// ============================================================================
// LEGACY STORES (deprecated - use query atoms above)
// Kept for backward compatibility with useEntityList hook
// ============================================================================

/**
 * @deprecated Use testsetQueryAtomFamily and testsetEntityAtomFamily instead
 *
 * Revision entity store
 *
 * Usage with hooks:
 * ```ts
 * // List revisions for a testset
 * const revisions = useEntityList(revisionStore, { projectId, testsetId })
 *
 * // Get single revision
 * const revision = useEntity(revisionStore, { id: revisionId, projectId })
 *
 * // Get from cache (after list fetch)
 * const cached = useEntityCached(revisionStore, revisionId)
 * ```
 */
export const revisionStore = createEntityStore<
    Revision,
    RevisionListParams,
    RevisionsResponse,
    RevisionDetailParams
>({
    name: "revision",
    schema: revisionSchema,
    // Revisions are immutable - never stale, never gc
    staleTime: Infinity,
    gcTime: Infinity,

    extractEntities: (response) => response.testset_revisions,

    fetchList: async ({projectId, testsetId}) => {
        const response = await axios.post(
            `${getAgentaApiUrl()}/preview/testsets/revisions/query`,
            {
                testset_refs: [{id: testsetId}],
                windowing: {limit: 100, order: "descending"},
            },
            {params: {project_id: projectId}},
        )
        return {
            testset_revisions: response.data?.testset_revisions ?? [],
            count: response.data?.count,
            windowing: response.data?.windowing,
        }
    },

    fetchDetail: async ({id, projectId}) => {
        const response = await axios.get(`${getAgentaApiUrl()}/preview/testsets/revisions/${id}`, {
            params: {project_id: projectId},
        })
        return revisionSchema.parse(response.data?.testset_revision ?? response.data)
    },

    normalize: (revision) => {
        // Ensure version is a number
        return {
            ...revision,
            version:
                typeof revision.version === "string"
                    ? parseInt(revision.version, 10)
                    : revision.version,
        }
    },
})

/**
 * Testset entity store
 *
 * Usage with hooks:
 * ```ts
 * // List testsets (metadata only)
 * const {data} = useEntityList(testsetStore, {projectId})
 *
 * // Get single testset
 * const testset = useEntity(testsetStore, {id: testsetId, projectId})
 *
 * // Get from cache (after list fetch)
 * const cached = useEntityCached(testsetStore, testsetId)
 * ```
 */
export const testsetStore = createEntityStore<
    Testset,
    TestsetListParams,
    TestsetsResponse,
    TestsetDetailParams
>({
    name: "testset",
    schema: testsetSchema,
    // Metadata can change; keep shortish cache window
    staleTime: 60_000,
    gcTime: 5 * 60_000,

    extractEntities: (response) => response.testsets,

    fetchList: async ({projectId, searchQuery}) => {
        const queryPayload: Record<string, unknown> = {
            windowing: {limit: 100, order: "descending"},
        }

        if (searchQuery && searchQuery.trim()) {
            queryPayload.testset = {name: searchQuery.trim()}
        }

        const response = await axios.post(
            `${getAgentaApiUrl()}/preview/testsets/query`,
            queryPayload,
            {params: {project_id: projectId}},
        )

        return {
            testsets: response.data?.testsets ?? [],
            count: response.data?.count,
        }
    },

    fetchDetail: async ({id, projectId}) => {
        const response = await axios.get(`${getAgentaApiUrl()}/preview/testsets/${id}`, {
            params: {project_id: projectId},
        })
        return testsetSchema.parse(response.data?.testset ?? response.data)
    },
})

/**
 * Variant entity store (contains name and description)
 */
export const variantStore = createEntityStore<
    Variant,
    never, // No list endpoint for now
    never,
    VariantDetailParams
>({
    name: "variant",
    schema: variantSchema,
    staleTime: 60_000,
    gcTime: 5 * 60_000,

    extractEntities: () => [],

    fetchList: async () => {
        throw new Error("Variant list not implemented")
    },

    fetchDetail: async ({id, projectId}) => {
        const response = await axios.get(`${getAgentaApiUrl()}/preview/testsets/variants/${id}`, {
            params: {project_id: projectId},
        })
        return variantSchema.parse(response.data?.testset_variant ?? response.data)
    },
})
