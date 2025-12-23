import axios from "@/oss/lib/api/assets/axiosConfig"
import {getAgentaApiUrl} from "@/oss/lib/helpers/api"
import {Testset, PreviewTestset} from "@/oss/lib/Types"
import {getProjectValues} from "@/oss/state/project"

import {PreviewTestsetsQueryPayload} from "./types"

//Prefix convention:
//  - fetch: GET single entity from server
//  - fetchAll: GET all entities from server
//  - create: POST data to server
//  - update: PUT data to server
//  - delete: DELETE data from server

export const fetchPreviewTestsets = async (payload: PreviewTestsetsQueryPayload = {}) => {
    const {projectId} = getProjectValues()

    const response = await axios.post(
        `${getAgentaApiUrl()}/preview/simple/testsets/query?project_id=${projectId}`,
        payload,
    )

    return response.data
}

export async function createNewTestset(testsetName: string, testsetData?: any) {
    const {projectId} = getProjectValues()

    // Transform testsetData to the format expected by the API
    // testsetData is array of key-value pairs, we need {data: {...}} format
    const testcases = testsetData?.length
        ? testsetData.map((row: Record<string, unknown>) => ({data: row}))
        : []

    const baseSlug = testsetName.toLowerCase().replace(/\s+/g, "_")
    const timestamp = Date.now()

    // Step 1: Create testset (artifact only) - add trailing slash to avoid 307
    const testsetResponse = await axios.post(
        `${getAgentaApiUrl()}/preview/testsets/?project_id=${projectId}`,
        {
            testset: {
                slug: baseSlug,
                name: testsetName,
                data: {
                    testcases: [],
                },
            },
        },
    )

    const testsetId = testsetResponse.data.testset?.id
    if (!testsetId) {
        return testsetResponse
    }

    // Step 2: Create variant for the testset
    const variantResponse = await axios.post(
        `${getAgentaApiUrl()}/preview/testsets/variants/?project_id=${projectId}`,
        {
            testset_variant: {
                testset_id: testsetId,
                slug: `${baseSlug}_default`,
                name: testsetName,
            },
        },
    )

    const variantId = variantResponse.data.testset_variant?.id
    if (!variantId) {
        return testsetResponse
    }

    // Step 3: Create v0 revision (with data if provided, empty otherwise)
    // User will edit this v0 to create v1 when they save
    const v0Response = await axios.post(
        `${getAgentaApiUrl()}/preview/testsets/revisions/commit?project_id=${projectId}`,
        {
            testset_revision_commit: {
                testset_id: testsetId,
                testset_variant_id: variantId,
                slug: `${baseSlug}_v0_${timestamp}`,
                message: "Initial setup",
                data: {
                    testcases,
                },
            },
        },
    )

    // Add revision ID to response for navigation (v0)
    if (v0Response.data.testset_revision?.id) {
        testsetResponse.data.revisionId = v0Response.data.testset_revision.id
    }

    return testsetResponse
}

export async function updateTestset(testsetId: string, testsetName: string, testsetData: any) {
    const {projectId} = getProjectValues()

    const response = await axios.put(
        `${getAgentaApiUrl()}/testsets/${testsetId}?project_id=${projectId}`,
        {
            name: testsetName,
            csvdata: testsetData,
        },
    )
    return response
}

export async function fetchTestset<T extends boolean = false>(
    testsetId: string,
    preview?: T,
): Promise<T extends true ? PreviewTestset : Testset> {
    if (!testsetId) {
        return null as any
    }
    const {projectId} = getProjectValues()

    if (preview) {
        // Use the query endpoint for preview
        const response = await axios.post(
            `${getAgentaApiUrl()}/preview/testsets/query?project_id=${projectId}`,
            {
                testset_refs: [{id: testsetId}],
                windowing: {limit: 1},
            },
        )
        const testsets = response?.data?.testsets ?? []
        return testsets[0] as T extends true ? PreviewTestset : Testset
    }

    const response = await axios.get(
        `${getAgentaApiUrl()}/testsets/${testsetId}?project_id=${projectId}`,
    )
    return response?.data as T extends true ? PreviewTestset : Testset
}

export const uploadTestsets = async (formData: FormData) => {
    const {projectId} = getProjectValues()

    const response = await axios.post(
        `${getAgentaApiUrl()}/testsets/upload?project_id=${projectId}`,
        formData,
        {
            headers: {
                "Content-Type": "multipart/form-data",
            },
            //@ts-ignore
            _ignoreError: true,
        },
    )
    return response
}

/**
 * Upload a testset file using the preview API (multipart file upload)
 * Sends the file to the backend for server-side parsing
 */
export const uploadTestsetPreview = async (
    file: File,
    fileType: "csv" | "json",
    testsetName?: string,
) => {
    const {projectId} = getProjectValues()

    const formData = new FormData()
    formData.append("file", file)
    formData.append("file_type", fileType)
    if (testsetName) {
        formData.append("testset_name", testsetName)
    }

    const response = await axios.post(
        `${getAgentaApiUrl()}/preview/simple/testsets/upload?project_id=${projectId}`,
        formData,
        {
            headers: {
                "Content-Type": "multipart/form-data",
            },
        },
    )

    return response
}

export const importTestsetsViaEndpoint = async (formData: FormData) => {
    const {projectId} = getProjectValues()

    const response = await axios.post(
        `${getAgentaApiUrl()}/testsets/endpoint?project_id=${projectId}`,
        formData,
        {
            headers: {"Content-Type": "multipart/form-data"},
        },
    )
    return response
}

export const deleteTestsets = async (ids: string[]) => {
    const {projectId} = getProjectValues()

    // Archive each testset using the new preview API
    const results = await Promise.all(
        ids.map((id) =>
            axios.post(
                `${getAgentaApiUrl()}/preview/simple/testsets/${id}/archive`,
                {},
                {params: {project_id: projectId}},
            ),
        ),
    )
    return results.map((r) => r.data)
}

/**
 * Testcase data structure for commit
 */
interface TestcaseForCommit {
    id?: string
    data: Record<string, unknown>
    set_id?: string
}

/**
 * Commit a new testset revision with updated testcases
 * Creates new testcases in the backend and links them to a new revision
 */
export async function commitTestsetRevision(
    testsetId: string,
    testcases: TestcaseForCommit[],
    message?: string,
) {
    const {projectId} = getProjectValues()

    const response = await axios.post(
        `${getAgentaApiUrl()}/preview/testsets/revisions/commit?project_id=${projectId}`,
        {
            testset_revision_commit: {
                testset_id: testsetId,
                message: message || "Updated testcases",
                data: {
                    testcases: testcases.map((tc) => ({
                        // Include id if it exists (for tracking, though backend creates new ones)
                        ...(tc.id && {id: tc.id}),
                        data: tc.data,
                        set_id: testsetId,
                    })),
                },
            },
        },
    )

    return response.data
}

/**
 * Patch operations for testset revision
 */
export interface TestsetRevisionPatchOperations {
    /** Testcases to update (existing testcases with modified data) */
    update?: {id: string; data: Record<string, unknown>}[]
    /** New testcases to create */
    create?: {data: Record<string, unknown>}[]
    /** Testcase IDs to delete */
    delete?: string[]
}

/**
 * Patch a testset revision with delta changes
 * Only sends the changes (update/create/delete) instead of full snapshot
 * This is safe for infinite scrolling since it doesn't require all data to be loaded
 */
export async function patchTestsetRevision(
    testsetId: string,
    operations: TestsetRevisionPatchOperations,
    message?: string,
    baseRevisionId?: string,
    description?: string,
    name?: string,
) {
    const {projectId} = getProjectValues()

    const response = await axios.post(
        `${getAgentaApiUrl()}/preview/testsets/revisions/patch?project_id=${projectId}`,
        {
            testset_revision_patch: {
                testset_id: testsetId,
                base_revision_id: baseRevisionId,
                message: message || "Patched testset revision",
                name,
                description,
                operations: {
                    update: operations.update?.map((tc) => ({
                        id: tc.id,
                        data: tc.data,
                        set_id: testsetId,
                    })),
                    create: operations.create?.map((tc) => ({
                        data: tc.data,
                        set_id: testsetId,
                    })),
                    delete: operations.delete,
                },
            },
        },
    )

    return response.data
}

/**
 * Archive (soft-delete) a testset revision
 * @param revisionId - The ID of the revision to archive
 * @returns The archived revision data
 */
export async function archiveTestsetRevision(revisionId: string) {
    const {projectId} = getProjectValues()

    const response = await axios.post(
        `${getAgentaApiUrl()}/testsets/revisions/${revisionId}/archive?project_id=${projectId}`,
    )

    return response.data
}
