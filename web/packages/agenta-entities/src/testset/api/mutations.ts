/**
 * Testset Mutation API Functions
 *
 * HTTP API functions for creating, updating, and deleting testset entities.
 * These are pure functions with no Jotai dependencies.
 */

import {getAgentaApiUrl, axios, validateUUID} from "@agenta/shared"

import type {TestsetRevisionDelta} from "../core"

// ============================================================================
// TESTSET CRUD
// ============================================================================

/**
 * Create a new testset with optional initial data
 * Uses the simple API which creates testset, variant, and revision in one call
 */
export async function createTestset(params: {
    projectId: string
    name: string
    testcases?: Record<string, unknown>[]
    commitMessage?: string
}) {
    const {projectId, name, testcases = [], commitMessage} = params

    // Transform testcases to the format expected by the API
    const formattedTestcases = testcases.map((row) => ({data: row}))

    // Create URL-safe slug
    const slug = name
        .toLowerCase()
        .replace(/\s+/g, "_")
        .replace(/[^a-z0-9_-]/g, "")

    const response = await axios.post(
        `${getAgentaApiUrl()}/preview/simple/testsets/`,
        {
            testset: {
                slug,
                name,
                data: {testcases: formattedTestcases},
            },
            message: commitMessage || undefined,
        },
        {params: {project_id: projectId}},
    )

    const simpleTestset = response.data.testset
    if (simpleTestset) {
        return {
            testset: {
                id: simpleTestset.id,
                name: simpleTestset.name,
                slug: simpleTestset.slug,
            },
            revisionId: simpleTestset.revision_id,
        }
    }

    return response.data
}

/**
 * Update testset metadata (name and/or description)
 * This does NOT create a new revision - it updates the testset entity itself
 */
export async function updateTestsetMetadata(params: {
    projectId: string
    testsetId: string
    name?: string
    description?: string
}) {
    const {projectId, testsetId, name, description} = params

    const response = await axios.put(
        `${getAgentaApiUrl()}/preview/testsets/${testsetId}`,
        {
            testset: {
                id: testsetId,
                ...(name !== undefined && {name}),
                ...(description !== undefined && {description}),
            },
        },
        {params: {project_id: projectId}},
    )

    return response.data?.testset
}

/**
 * Clone a testset - creates a new testset with the same data
 */
export async function cloneTestset(params: {
    projectId: string
    sourceTestsetId: string
    newName: string
}) {
    const {projectId, sourceTestsetId, newName} = params

    // Fetch the source testset
    const sourceResponse = await axios.get(
        `${getAgentaApiUrl()}/preview/simple/testsets/${sourceTestsetId}`,
        {params: {project_id: projectId}},
    )

    const sourceTestset = sourceResponse.data?.testset
    if (!sourceTestset) {
        throw new Error("Source testset not found")
    }

    // Create URL-safe slug
    const slug = newName
        .toLowerCase()
        .replace(/\s+/g, "_")
        .replace(/[^a-z0-9_-]/g, "")

    const response = await axios.post(
        `${getAgentaApiUrl()}/preview/simple/testsets/`,
        {
            testset: {
                slug,
                name: newName,
                description: sourceTestset.description,
                data: sourceTestset.data || {testcases: []},
            },
        },
        {params: {project_id: projectId}},
    )

    const simpleTestset = response.data.testset
    if (simpleTestset) {
        return {
            testset: {
                id: simpleTestset.id,
                name: simpleTestset.name,
                slug: simpleTestset.slug,
            },
            revisionId: simpleTestset.revision_id,
        }
    }

    return response.data
}

/**
 * Archive (soft-delete) testsets
 */
export async function archiveTestsets(params: {projectId: string; testsetIds: string[]}) {
    const {projectId, testsetIds} = params

    const results = await Promise.all(
        testsetIds.map((id) =>
            axios.post(
                `${getAgentaApiUrl()}/preview/simple/testsets/${id}/archive`,
                {},
                {params: {project_id: projectId}},
            ),
        ),
    )

    return results.map((r) => r.data)
}

// ============================================================================
// REVISION MUTATIONS
// ============================================================================

/**
 * Patch a testset revision with delta changes
 * Only sends the changes (update/create/delete) instead of full snapshot
 * This is safe for infinite scrolling since it doesn't require all data to be loaded
 *
 * Column operations (rename/add/delete) are applied to ALL testcases by the backend,
 * so they work correctly even with infinite scrolling where not all data is loaded.
 */
export async function patchRevision(params: {
    projectId: string
    testsetId: string
    operations: TestsetRevisionDelta
    message?: string
    baseRevisionId?: string
    name?: string
    description?: string
}) {
    const {projectId, testsetId, operations, message, baseRevisionId, name, description} = params

    const response = await axios.post(
        `${getAgentaApiUrl()}/preview/testsets/revisions/commit`,
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
                    columns: operations.columns,
                },
            },
        },
        {params: {project_id: projectId}},
    )

    return response.data
}

/**
 * Commit a new testset revision with full testcases data
 * Creates new testcases in the backend and links them to a new revision
 */
export async function commitRevision(params: {
    projectId: string
    testsetId: string
    testcases: {id?: string; data: Record<string, unknown>}[]
    message?: string
}) {
    const {projectId, testsetId, testcases, message} = params

    const response = await axios.post(
        `${getAgentaApiUrl()}/preview/testsets/revisions/commit`,
        {
            testset_revision_commit: {
                testset_id: testsetId,
                message: message || "Updated testcases",
                data: {
                    testcases: testcases.map((tc) => ({
                        ...(tc.id && {id: tc.id}),
                        data: tc.data,
                        set_id: testsetId,
                    })),
                },
            },
        },
        {params: {project_id: projectId}},
    )

    return response.data
}

/**
 * Archive (soft-delete) a testset revision
 */
export async function archiveRevision(params: {projectId: string; revisionId: string}) {
    const {projectId, revisionId} = params

    // Validate UUID to prevent SSRF attacks
    validateUUID(revisionId, "revisionId")

    const response = await axios.post(
        `${getAgentaApiUrl()}/preview/testsets/revisions/${revisionId}/archive`,
        {},
        {params: {project_id: projectId}},
    )

    return response.data
}

// ============================================================================
// FILE UPLOAD
// ============================================================================

/**
 * Upload a testset file (creates a NEW testset)
 * Sends the file to the backend for server-side parsing
 */
export async function uploadTestsetFile(params: {
    projectId: string
    file: File
    fileType: "csv" | "json"
    testsetName?: string
}) {
    const {projectId, file, fileType, testsetName} = params

    const formData = new FormData()
    formData.append("file", file)
    formData.append("file_type", fileType)
    if (testsetName) {
        formData.append("testset_name", testsetName)
    }

    const response = await axios.post(
        `${getAgentaApiUrl()}/preview/simple/testsets/upload`,
        formData,
        {
            params: {project_id: projectId},
            headers: {"Content-Type": "multipart/form-data"},
        },
    )

    return response.data
}

/**
 * Upload a file to an EXISTING testset as a new revision
 * Sends the file to the backend for server-side parsing
 */
export async function uploadRevisionFile(params: {
    projectId: string
    testsetId: string
    file: File
    fileType: "csv" | "json"
    testsetName?: string
}) {
    const {projectId, testsetId, file, fileType, testsetName} = params

    const formData = new FormData()
    formData.append("file", file)
    formData.append("file_type", fileType)
    if (testsetName) {
        formData.append("testset_name", testsetName)
    }

    const response = await axios.post(
        `${getAgentaApiUrl()}/preview/simple/testsets/${testsetId}/upload`,
        formData,
        {
            params: {project_id: projectId},
            headers: {"Content-Type": "multipart/form-data"},
        },
    )

    return response.data
}

// ============================================================================
// FILE DOWNLOAD
// ============================================================================

export type ExportFileType = "csv" | "json"

const MIME_TYPES: Record<ExportFileType, string> = {
    csv: "text/csv;charset=utf-8;",
    json: "application/json;charset=utf-8;",
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

/**
 * Download a testset file (latest revision)
 * Uses the backend endpoint to generate and download the file
 */
export async function downloadTestset(params: {
    projectId: string
    testsetId: string
    fileType?: ExportFileType
    filename?: string
}) {
    const {projectId, testsetId, fileType = "csv", filename} = params

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
 * Download a specific testset revision file
 * Uses the backend endpoint to generate and download the file for a specific revision
 */
export async function downloadRevision(params: {
    projectId: string
    revisionId: string
    fileType?: ExportFileType
    filename?: string
}) {
    const {projectId, revisionId, fileType = "csv", filename} = params

    // Validate UUID to prevent SSRF attacks
    validateUUID(revisionId, "revisionId")

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

// ============================================================================
// SIMPLE TESTSET API (for quick operations)
// ============================================================================

/**
 * Fetch a simple testset by ID (includes latest revision data)
 */
export async function fetchSimpleTestset(params: {projectId: string; testsetId: string}) {
    const {projectId, testsetId} = params

    const response = await axios.get(`${getAgentaApiUrl()}/preview/simple/testsets/${testsetId}`, {
        params: {project_id: projectId},
    })

    return response.data?.testset
}

/**
 * Query preview testsets with optional filters
 */
export async function queryPreviewTestsets(params: {
    projectId: string
    payload?: Record<string, unknown>
}) {
    const {projectId, payload = {}} = params

    const response = await axios.post(
        `${getAgentaApiUrl()}/preview/simple/testsets/query`,
        payload,
        {params: {project_id: projectId}},
    )

    return response.data
}
