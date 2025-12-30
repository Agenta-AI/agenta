import axios from "@/oss/lib/api/assets/axiosConfig"
import {getAgentaApiUrl} from "@/oss/lib/helpers/api"

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

/**
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
