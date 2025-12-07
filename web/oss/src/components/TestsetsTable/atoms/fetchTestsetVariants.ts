import axios from "@/oss/lib/api/assets/axiosConfig"
import {getAgentaApiUrl} from "@/oss/lib/helpers/api"
import {getProjectValues} from "@/oss/state/project"

/**
 * Testset variant from /preview/testsets/variants/query
 */
export interface TestsetVariant {
    id: string
    testset_id: string
    name: string
    description?: string
    created_at: string
    updated_at: string
    created_by_id?: string
    updated_by_id?: string
    flags?: {
        has_testcases?: boolean
        has_traces?: boolean
    }
    meta?: Record<string, unknown>
    tags?: Record<string, unknown>
}

/**
 * Testset revision from /preview/testsets/revisions/query
 */
export interface TestsetRevision {
    id: string
    testset_id: string
    testset_variant_id: string
    version?: string
    message?: string
    created_at: string
    updated_at: string
    created_by_id?: string
    flags?: {
        has_testcases?: boolean
        has_traces?: boolean
    }
    data?: {
        testcase_ids?: string[]
    }
}

interface FetchTestsetVariantsParams {
    testsetId: string
}

/**
 * Fetch variants for a specific testset
 */
export const fetchTestsetVariants = async ({
    testsetId,
}: FetchTestsetVariantsParams): Promise<TestsetVariant[]> => {
    const {projectId} = getProjectValues()

    if (!projectId || !testsetId) {
        return []
    }

    try {
        const response = await axios.post(
            `${getAgentaApiUrl()}/preview/testsets/variants/query`,
            {
                testset_refs: [{id: testsetId}],
                windowing: {
                    limit: 100,
                    order: "descending",
                },
            },
            {
                params: {project_id: projectId},
            },
        )

        const data = response.data
        const variants = data?.testset_variants ?? []

        // Filter variants to only include those belonging to this testset
        // (API should filter, but we double-check client-side)
        return variants
            .filter((variant: any) => {
                const variantTestsetId = variant.testset_id ?? variant.artifact_id
                return variantTestsetId === testsetId
            })
            .map((variant: any) => ({
                id: variant.id,
                testset_id: variant.testset_id ?? variant.artifact_id,
                name: variant.name,
                description: variant.description,
                created_at: variant.created_at,
                updated_at: variant.updated_at,
                created_by_id: variant.created_by_id,
                updated_by_id: variant.updated_by_id,
                flags: variant.flags,
                meta: variant.meta,
                tags: variant.tags,
            }))
    } catch (error) {
        console.error("[TestsetsTable] Failed to fetch testset variants:", error)
        return []
    }
}

interface FetchTestsetRevisionsParams {
    testsetId: string
    variantId?: string
}

/**
 * Fetch revisions for a specific testset or variant
 */
export const fetchTestsetRevisions = async ({
    testsetId,
    variantId,
}: FetchTestsetRevisionsParams): Promise<TestsetRevision[]> => {
    const {projectId} = getProjectValues()

    if (!projectId || !testsetId) {
        return []
    }

    try {
        const payload: Record<string, unknown> = {
            windowing: {
                limit: 100,
                order: "descending",
            },
        }

        if (variantId) {
            payload.testset_variant_refs = [{id: variantId}]
        } else {
            payload.testset_refs = [{id: testsetId}]
        }

        const response = await axios.post(
            `${getAgentaApiUrl()}/preview/testsets/revisions/query`,
            payload,
            {
                params: {project_id: projectId},
            },
        )

        const data = response.data
        const revisions = data?.testset_revisions ?? []

        // Filter out v0 revisions (initial commits) and map to typed objects
        return revisions
            .filter((revision: any) => revision.version !== "0" && revision.version !== 0)
            .map((revision: any) => ({
                id: revision.id,
                testset_id: revision.testset_id ?? revision.artifact_id,
                testset_variant_id: revision.testset_variant_id ?? revision.variant_id,
                version: revision.version,
                message: revision.message,
                created_at: revision.created_at,
                updated_at: revision.updated_at,
                created_by_id: revision.created_by_id,
                flags: revision.flags,
                data: revision.data,
            }))
    } catch (error) {
        console.error("[TestsetsTable] Failed to fetch testset revisions:", error)
        return []
    }
}
