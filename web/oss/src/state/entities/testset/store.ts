import axios from "@/oss/lib/api/assets/axiosConfig"
import {getAgentaApiUrl} from "@/oss/lib/helpers/api"

import {createEntityStore} from "../core/createEntityStore"

import {revisionSchema, type Revision, type RevisionsResponse} from "./revisionSchema"

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

// ============================================================================
// API FUNCTIONS (exported for use in other modules)
// ============================================================================

/**
 * Fetch a single revision by ID
 */
export async function fetchRevision({id, projectId}: RevisionDetailParams): Promise<Revision> {
    const response = await axios.get(`${getAgentaApiUrl()}/preview/testsets/revisions/${id}`, {
        params: {project_id: projectId},
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
    staleTime: 60_000, // 1 minute
    gcTime: 5 * 60_000, // 5 minutes

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
