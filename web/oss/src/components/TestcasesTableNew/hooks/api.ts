import axios from "@/oss/lib/api/assets/axiosConfig"
import {getAgentaApiUrl} from "@/oss/lib/helpers/api"
import {flattenTestcase, testcasesResponseSchema} from "@/oss/state/entities/testcase/schema"

import type {TestcasesPage} from "./types"

/** Page size for testcases pagination */
export const PAGE_SIZE = 50

/**
 * Fetch revision metadata from API (no testcases - just metadata)
 */
export async function fetchRevision(projectId: string, revisionId: string) {
    const response = await axios.get(
        `${getAgentaApiUrl()}/preview/testsets/revisions/${revisionId}`,
        {params: {project_id: projectId, include_testcases: true}},
    )
    return response.data?.testset_revision
}

/**
 * Fetch paginated testcases using /preview/testcases/query endpoint
 * Uses testset_revision_id to fetch testcases for a specific revision
 */
export async function fetchTestcasesPage(
    projectId: string,
    revisionId: string,
    cursor: string | null,
): Promise<TestcasesPage> {
    const response = await axios.post(
        `${getAgentaApiUrl()}/preview/testcases/query`,
        {
            testset_revision_id: revisionId,
            windowing: {
                limit: PAGE_SIZE,
                ...(cursor && {next: cursor}),
            },
        },
        {params: {project_id: projectId}},
    )

    // Validate response with Zod
    const validated = testcasesResponseSchema.parse(response.data)

    // Flatten testcases for table display
    const flattenedTestcases = validated.testcases.map(flattenTestcase)

    return {
        testcases: flattenedTestcases,
        count: validated.count,
        nextCursor: validated.windowing?.next || null,
        hasMore: Boolean(validated.windowing?.next),
    }
}

/**
 * Fetch testset metadata (name) from API
 */
export async function fetchTestsetName(projectId: string, testsetId: string): Promise<string> {
    const response = await axios.post(
        `${getAgentaApiUrl()}/preview/testsets/query`,
        {
            testset_refs: [{id: testsetId}],
            windowing: {limit: 1},
        },
        {params: {project_id: projectId}},
    )
    const testsets = response.data?.testsets ?? []
    return testsets[0]?.name ?? ""
}

/**
 * Fetch all revisions for a testset (using already-known testsetId)
 */
export async function fetchRevisionsByTestsetId(
    projectId: string,
    testsetId: string,
): Promise<{id: string; version: number; created_at: string}[]> {
    const response = await axios.post(
        `${getAgentaApiUrl()}/preview/testsets/revisions/query`,
        {
            testset_refs: [{id: testsetId}],
            windowing: {limit: 100},
        },
        {params: {project_id: projectId}},
    )
    const revisions = response.data?.testset_revisions ?? []
    return revisions.map((rev: any) => ({
        id: rev.id,
        version: rev.version ?? 0,
        created_at: rev.created_at,
    }))
}
