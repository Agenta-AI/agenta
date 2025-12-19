import {keepPreviousData} from "@tanstack/react-query"
import {atom} from "jotai"
import {atomWithQuery} from "jotai-tanstack-query"

import axios from "@/oss/lib/api/assets/axiosConfig"
import {getAgentaApiUrl} from "@/oss/lib/helpers/api"
import {projectIdAtom} from "@/oss/state/project/selectors/project"

import {flattenTestcase, testcasesResponseSchema, type FlattenedTestcase} from "./schema"

// ============================================================================
// QUERY ATOMS
// Uses atomWithQuery for reactive data fetching with Jotai + TanStack Query
// ============================================================================

/**
 * Current revision ID context - set by the hook/component
 */
export const currentRevisionIdAtom = atom<string | null>(null)

/**
 * Revision data response type
 */
export interface RevisionData {
    id: string
    testset_id: string
    version: number
    description?: string
    message?: string
    author?: string
    created_at?: string
    updated_at?: string
}

/**
 * Query atom for fetching revision metadata
 * Uses placeholderData to keep previous data while loading new revision
 */
export const revisionQueryAtom = atomWithQuery<RevisionData | null>((get) => {
    const projectId = get(projectIdAtom)
    const revisionId = get(currentRevisionIdAtom)

    return {
        queryKey: ["testset-revision", projectId, revisionId],
        queryFn: async () => {
            if (!projectId || !revisionId) return null
            const response = await axios.get(
                `${getAgentaApiUrl()}/preview/testsets/revisions/${revisionId}`,
                {params: {project_id: projectId}},
            )
            return response.data?.testset_revision ?? null
        },
        enabled: Boolean(projectId && revisionId),
        staleTime: 30_000,
        placeholderData: keepPreviousData,
    }
})

/**
 * Derived atom for testset ID from revision
 */
export const testsetIdAtom = atom((get) => {
    const revisionQuery = get(revisionQueryAtom)
    return revisionQuery.data?.testset_id ?? null
})

/**
 * Query atom for fetching testset name
 */
export const testsetNameQueryAtom = atomWithQuery<string>((get) => {
    const projectId = get(projectIdAtom)
    const testsetId = get(testsetIdAtom)

    return {
        queryKey: ["testset-name", projectId, testsetId],
        queryFn: async () => {
            if (!projectId || !testsetId) return ""
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
        },
        enabled: Boolean(projectId && testsetId),
        staleTime: 60_000,
    }
})

/**
 * Revision list item type
 */
export interface RevisionListItem {
    id: string
    version: number
    created_at: string
    message?: string
    author?: string
}

/**
 * Query atom for fetching available revisions
 */
export const revisionsListQueryAtom = atomWithQuery<RevisionListItem[]>((get) => {
    const projectId = get(projectIdAtom)
    const testsetId = get(testsetIdAtom)

    return {
        queryKey: ["testset-revisions", projectId, testsetId],
        queryFn: async () => {
            if (!projectId || !testsetId) return []
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
                message: rev.message,
                author: rev.author,
            }))
        },
        enabled: Boolean(projectId && testsetId),
        staleTime: 60_000,
    }
})

/**
 * Page size for testcases pagination
 */
export const PAGE_SIZE = 50

/**
 * Testcases page response type
 */
export interface TestcasesPage {
    testcases: FlattenedTestcase[]
    count: number
    nextCursor: string | null
    hasMore: boolean
}

/**
 * Fetch a page of testcases (used by useInfiniteQuery in hook)
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

// ============================================================================
// DERIVED METADATA ATOM
// Combines data from multiple query atoms into a single metadata object
// ============================================================================

/**
 * Testset metadata interface
 */
export interface TestsetMetadata {
    testsetId: string
    testsetName: string
    revisionVersion?: number
    description?: string
    commitMessage?: string
    author?: string
    createdAt?: string
    updatedAt?: string
}

/**
 * Derived atom: full metadata object from query atoms
 * Automatically updates when any query data changes
 */
export const testsetMetadataAtom = atom((get): TestsetMetadata | null => {
    const revisionQuery = get(revisionQueryAtom)
    const nameQuery = get(testsetNameQueryAtom)

    const revision = revisionQuery.data
    if (!revision?.testset_id) return null

    return {
        testsetId: revision.testset_id,
        testsetName: nameQuery.data ?? "",
        revisionVersion: revision.version,
        description: revision.description,
        commitMessage: revision.message,
        author: revision.author,
        createdAt: revision.created_at,
        updatedAt: revision.updated_at,
    }
})

/**
 * Loading state for all metadata queries
 */
export const metadataLoadingAtom = atom((get) => {
    const revisionQuery = get(revisionQueryAtom)
    const nameQuery = get(testsetNameQueryAtom)
    return revisionQuery.isPending || nameQuery.isPending
})

/**
 * Error state for metadata queries
 */
export const metadataErrorAtom = atom((get) => {
    const revisionQuery = get(revisionQueryAtom)
    const nameQuery = get(testsetNameQueryAtom)
    return (revisionQuery.error || nameQuery.error) as Error | null
})
