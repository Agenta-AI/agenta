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

export async function createNewTestset(
    testsetName: string,
    testsetData?: any,
    commitMessage?: string,
) {
    const {projectId} = getProjectValues()

    // Transform testsetData to the format expected by the API
    // testsetData is array of key-value pairs, we need {data: {...}} format
    const testcases = testsetData?.length
        ? testsetData.map((row: Record<string, unknown>) => ({data: row}))
        : []

    const baseSlug = testsetName.toLowerCase().replace(/\s+/g, "_")

    // Use /preview/simple/testsets endpoint - creates testset, variant, and revision in one call
    const response = await axios.post(
        `${getAgentaApiUrl()}/preview/simple/testsets/?project_id=${projectId}`,
        {
            testset: {
                slug: baseSlug,
                name: testsetName,
                data: {
                    testcases,
                },
            },
            message: commitMessage || undefined,
        },
    )

    // Transform response to match expected format
    // The simple endpoint returns { testset: SimpleTestset } with revision_id included
    const simpleTestset = response.data.testset
    if (simpleTestset) {
        return {
            data: {
                testset: {
                    id: simpleTestset.id,
                    name: simpleTestset.name,
                    slug: simpleTestset.slug,
                },
                revisionId: simpleTestset.revision_id,
            },
        }
    }

    return response
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

/**
 * Fetch a simple testset by ID using the preview API
 * Returns testset with its latest revision data
 */
export async function fetchSimpleTestset(testsetId: string) {
    const {projectId} = getProjectValues()

    const response = await axios.get(
        `${getAgentaApiUrl()}/preview/simple/testsets/${testsetId}?project_id=${projectId}`,
    )

    return response.data?.testset
}

/**
 * Update testset metadata (name and/or description) directly on the testset entity
 * This does NOT create a new revision - it updates the testset itself
 */
export async function updateTestsetMetadata(
    testsetId: string,
    updates: {name?: string; description?: string},
) {
    const {projectId} = getProjectValues()

    const response = await axios.put(
        `${getAgentaApiUrl()}/preview/testsets/${testsetId}?project_id=${projectId}`,
        {
            testset: {
                id: testsetId,
                ...updates,
            },
        },
    )

    return response.data?.testset
}

/**
 * Rename a testset using the preview API
 * Only updates the name, preserves all other data
 * @deprecated Use updateTestsetMetadata instead
 */
export async function renameTestset(testsetId: string, newName: string) {
    const {projectId} = getProjectValues()

    // First fetch the current testset to get its data
    const currentTestset = await fetchSimpleTestset(testsetId)

    if (!currentTestset) {
        throw new Error("Testset not found")
    }

    // Update with new name, preserving existing data
    const response = await axios.put(
        `${getAgentaApiUrl()}/preview/simple/testsets/${testsetId}?project_id=${projectId}`,
        {
            testset: {
                id: testsetId,
                name: newName,
                description: currentTestset.description,
                data: currentTestset.data,
            },
        },
    )

    return response.data?.testset
}

/**
 * Clone a testset using the preview API
 * Creates a new testset with the same data but a new name
 */
export async function cloneTestset(sourceTestsetId: string, newName: string) {
    const {projectId} = getProjectValues()

    // Fetch the source testset
    const sourceTestset = await fetchSimpleTestset(sourceTestsetId)

    if (!sourceTestset) {
        throw new Error("Source testset not found")
    }

    // Create a new testset with the same data
    const baseSlug = newName.toLowerCase().replace(/\s+/g, "_")

    const response = await axios.post(
        `${getAgentaApiUrl()}/preview/simple/testsets/?project_id=${projectId}`,
        {
            testset: {
                slug: baseSlug,
                name: newName,
                description: sourceTestset.description,
                data: sourceTestset.data || {testcases: []},
            },
        },
    )

    // Transform response to match expected format
    const simpleTestset = response.data.testset
    if (simpleTestset) {
        return {
            data: {
                testset: {
                    id: simpleTestset.id,
                    name: simpleTestset.name,
                    slug: simpleTestset.slug,
                },
                revisionId: simpleTestset.revision_id,
            },
        }
    }

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
 * Column-level operations for testset revision
 * These operations are applied to ALL testcases in the revision
 */
export interface TestsetRevisionDeltaColumns {
    /** Add columns: array of column names to add */
    add?: string[]
    /** Remove columns: array of column names to remove */
    remove?: string[]
    /** Replace columns: array of [old column name, new column name] to replace */
    replace?: [string, string][]
}

export interface TestsetRevisionDeltaRows {
    /** Add rows: array of testcases to add */
    add?: {data: Record<string, unknown>}[]
    /** Remove rows: array of testcase IDs to remove */
    remove?: string[]
    /** Replace rows: array of testcases to replace */
    replace?: {id: string; data: Record<string, unknown>}[]
}

/**
 * Patch operations for testset revision
 */
export interface TestsetRevisionDelta {
    /** Row-level operations */
    rows?: TestsetRevisionDeltaRows
    /** Column-level operations */
    columns?: TestsetRevisionDeltaColumns
}

/**
 * Patch a testset revision with delta changes
 * Only sends the changes (update/create/delete) instead of full snapshot
 * This is safe for infinite scrolling since it doesn't require all data to be loaded
 *
 * Column operations (rename/add/delete) are applied to ALL testcases by the backend,
 * so they work correctly even with infinite scrolling where not all data is loaded.
 */
export async function patchTestsetRevision(
    testsetId: string,
    operations: TestsetRevisionDelta,
    message?: string,
    baseRevisionId?: string,
    description?: string,
    name?: string,
) {
    const {projectId} = getProjectValues()

    const response = await axios.post(
        `${getAgentaApiUrl()}/preview/testsets/revisions/commit?project_id=${projectId}`,
        {
            testset_revision_commit: {
                testset_id: testsetId,
                revision_id: baseRevisionId,
                message: message || null,
                name,
                description,
                delta: {
                    rows: operations.rows
                        ? {
                              replace: operations.rows.replace?.map((tc) => ({
                                  id: tc.id,
                                  data: tc.data,
                                  set_id: testsetId,
                              })),
                              add: operations.rows.add?.map((tc) => ({
                                  data: tc.data,
                                  set_id: testsetId,
                              })),
                              remove: operations.rows.remove,
                          }
                        : undefined,
                    // Column operations are applied to ALL testcases by the backend
                    columns: operations.columns,
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
        `${getAgentaApiUrl()}/preview/testsets/revisions/${revisionId}/archive?project_id=${projectId}`,
    )

    return response.data
}

/**
 * Helper to trigger a file download from a blob response
 */
function triggerBlobDownload(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.setAttribute("download", filename)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    setTimeout(() => URL.revokeObjectURL(url), 500)
}

export type ExportFileType = "csv" | "json"

const MIME_TYPES: Record<ExportFileType, string> = {
    csv: "text/csv;charset=utf-8;",
    json: "application/json;charset=utf-8;",
}

/**
 * Download a testset file (latest revision)
 * Uses the backend endpoint to generate and download the file
 * @param testsetId - The ID of the testset to download
 * @param fileType - The file type to download (csv or json)
 * @param filename - Optional filename for the downloaded file (defaults to testset name)
 */
export async function downloadTestset(
    testsetId: string,
    fileType: ExportFileType = "csv",
    filename?: string,
) {
    const {projectId} = getProjectValues()

    const response = await axios.post(
        `${getAgentaApiUrl()}/preview/simple/testsets/${testsetId}/download`,
        {},
        {
            params: {project_id: projectId, file_type: fileType},
            responseType: "blob",
        },
    )

    const blob =
        response.data instanceof Blob
            ? response.data
            : new Blob([response.data], {type: MIME_TYPES[fileType]})

    triggerBlobDownload(blob, filename || `testset-${testsetId}.${fileType}`)

    return response
}

/**
 * Download a testset as CSV file (latest revision)
 * @deprecated Use downloadTestset(testsetId, "csv", filename) instead
 */
export async function downloadTestsetCsv(testsetId: string, filename?: string) {
    return downloadTestset(testsetId, "csv", filename)
}

/**
 * Download a specific testset revision file
 * Uses the backend endpoint to generate and download the file for a specific revision
 * @param revisionId - The ID of the revision to download
 * @param fileType - The file type to download (csv or json)
 * @param filename - Optional filename for the downloaded file
 */
export async function downloadRevision(
    revisionId: string,
    fileType: ExportFileType = "csv",
    filename?: string,
) {
    const {projectId} = getProjectValues()

    const response = await axios.post(
        `${getAgentaApiUrl()}/preview/testsets/revisions/${revisionId}/download`,
        {},
        {
            params: {project_id: projectId, file_type: fileType, _t: Date.now()},
            responseType: "blob",
        },
    )

    const blob = new Blob([response.data], {type: MIME_TYPES[fileType]})
    triggerBlobDownload(blob, filename || `revision-${revisionId}.${fileType}`)

    return response
}

/**
 * Download a specific testset revision as CSV file
 * @deprecated Use downloadRevision(revisionId, "csv", filename) instead
 */
export async function downloadRevisionCsv(revisionId: string, filename?: string) {
    return downloadRevision(revisionId, "csv", filename)
}
