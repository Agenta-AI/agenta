/**
 * @deprecated This file is deprecated. Use the centralized entity store instead:
 *
 * ```typescript
 * import { fetchRevisionsList, type Revision } from "@/oss/state/entities/testset"
 * ```
 *
 * The centralized entity store provides:
 * - Zod schema validation
 * - Entity caching
 * - Consistent API across the app
 * - Better type safety
 *
 * This file is kept for backwards compatibility only and should not be used in new code.
 */

import axios from "@/oss/lib/api/assets/axiosConfig"
import {getAgentaApiUrl} from "@/oss/lib/helpers/api"
import {getProjectValues} from "@/oss/state/project"

/**
 * Testset revision from /preview/testsets/revisions/query
 *
 * Note: We skip the variant layer entirely. The frontend works directly with
 * testsets and their revisions (2-level hierarchy instead of 3-level).
 *
 * @deprecated Use `Revision` type from "@/oss/state/entities/testset" instead
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
 *
 * @deprecated Use `fetchRevisionsList` from "@/oss/state/entities/testset" instead:
 * ```typescript
 * import { fetchRevisionsList } from "@/oss/state/entities/testset"
 * const response = await fetchRevisionsList({ projectId, testsetId })
 * const revisions = response.testset_revisions
 * ```
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

        // Map to typed objects first
        const mappedRevisions = revisions.map((revision: any) => ({
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

        // Only filter out v0 if there are other revisions (v1+)
        // If v0 is the only revision, show it so user can edit and create v1
        const isV0 = (r: TestsetRevision) => r.version === "0" || String(r.version) === "0"
        const hasNonV0Revisions = mappedRevisions.some((r: TestsetRevision) => !isV0(r))

        if (hasNonV0Revisions) {
            return mappedRevisions.filter((r: TestsetRevision) => !isV0(r))
        }

        return mappedRevisions
    } catch (error) {
        console.error("[TestsetsTable] Failed to fetch testset revisions:", error)
        return []
    }
}
