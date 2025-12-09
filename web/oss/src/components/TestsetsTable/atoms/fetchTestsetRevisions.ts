import axios from "@/oss/lib/api/assets/axiosConfig"
import {getAgentaApiUrl} from "@/oss/lib/helpers/api"
import {getProjectValues} from "@/oss/state/project"

/**
 * Testset revision from /preview/testsets/revisions/query
 *
 * Note: We skip the variant layer entirely. The frontend works directly with
 * testsets and their revisions (2-level hierarchy instead of 3-level).
 */
export interface TestsetRevision {
    id: string
    testset_id: string
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

interface FetchTestsetRevisionsParams {
    testsetId: string
}

/**
 * Fetch revisions for a specific testset.
 *
 * Note: We fetch revisions directly by testset_id, skipping the variant layer.
 * The backend supports variants, but the frontend uses only testsets + revisions.
 */
export const fetchTestsetRevisions = async ({
    testsetId,
}: FetchTestsetRevisionsParams): Promise<TestsetRevision[]> => {
    const {projectId} = getProjectValues()

    if (!projectId || !testsetId) {
        return []
    }

    try {
        const response = await axios.post(
            `${getAgentaApiUrl()}/preview/testsets/revisions/query`,
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
        const revisions = data?.testset_revisions ?? []

        // Filter out v0 revisions (initial commits) and map to typed objects
        return revisions
            .filter((revision: any) => revision.version !== "0" && revision.version !== 0)
            .map((revision: any) => ({
                id: revision.id,
                testset_id: revision.testset_id ?? revision.artifact_id,
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
