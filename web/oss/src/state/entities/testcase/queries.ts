import {keepPreviousData} from "@tanstack/react-query"
import {atom} from "jotai"
import {atomWithQuery} from "jotai-tanstack-query"

import axios from "@/oss/lib/api/assets/axiosConfig"
import {getAgentaApiUrl} from "@/oss/lib/helpers/api"
import {projectIdAtom} from "@/oss/state/project/selectors/project"

import {
    fetchRevision,
    revisionDraftAtomFamily,
    revisionsListQueryAtomFamily,
    variantStatefulAtomFamily,
    type Revision,
    type RevisionListItem,
} from "../testset"

import {flattenTestcase, testcasesResponseSchema, type FlattenedTestcase} from "./schema"

// ============================================================================
// REVISION CONTEXT ATOM
// Single source of truth for current revision ID (from URL)
// ============================================================================

/**
 * Current revision ID from URL - single source of truth
 * This atom is the canonical location for the current revision context.
 * Components set this from URL params, entity atoms read from it.
 */
export const currentRevisionIdAtom = atom<string | null>(null)

// ============================================================================
// QUERY ATOMS
// Uses API functions and context from testset module
// ============================================================================

/**
 * Revision data response type (re-export for backward compatibility)
 */
export type RevisionData = Revision

/**
 * Query atom for fetching revision metadata
 * Uses fetchRevision from testset module
 * For "draft" or "new" revision (new testsets), returns mock data without server query
 */
export const revisionQueryAtom = atomWithQuery<Revision | null>((get) => {
    const projectId = get(projectIdAtom)
    const revisionId = get(currentRevisionIdAtom)

    // For "draft" or "new" revision (new testsets), return mock revision without server query
    const isLocalOnly = revisionId === "draft" || revisionId === "new"

    return {
        queryKey: ["testset-revision", projectId, revisionId],
        queryFn: async () => {
            if (!projectId || !revisionId) return null
            if (isLocalOnly) {
                // Return mock revision for local-only testsets (client-side only)
                return {
                    id: revisionId,
                    testset_id: "",
                    version: 0,
                    name: "",
                    description: null,
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                } as Revision
            }
            return fetchRevision({id: revisionId, projectId})
        },
        enabled: Boolean(projectId && revisionId),
        // Revisions are immutable - never stale
        staleTime: Infinity,
        gcTime: Infinity,
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
 * Query atom for variant detail
 * Uses stateful atom family which automatically fetches if not in cache
 * Variants contain the name and description
 */
export const variantDetailQueryAtom = atom((get) => {
    const revisionQuery = get(revisionQueryAtom)
    const variantId = revisionQuery.data?.testset_variant_id

    if (!variantId) {
        return {data: null, isPending: false, isError: false, error: null}
    }

    // Stateful atom handles fetching automatically if entity not in cache
    return get(variantStatefulAtomFamily(variantId))
})

/**
 * Revision list item type (re-export for backward compatibility)
 */
export type {RevisionListItem} from "../testset"

/**
 * Query atom for fetching available revisions
 * Uses revisionsListQueryAtomFamily from testset entity module
 * This ensures revisions are hydrated into the entity cache
 */
export const revisionsListQueryAtom = atom((get) => {
    const testsetId = get(testsetIdAtom)
    if (!testsetId) {
        return {data: [] as RevisionListItem[], isPending: false, isError: false}
    }
    return get(revisionsListQueryAtomFamily(testsetId))
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
    testsetSlug?: string
    revisionSlug?: string
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
 * Triggers testset fetch to ensure entity is loaded
 *
 * NOTE: Uses revisionStatefulAtomFamily which includes:
 * - Batch-fetched server data
 * - Draft changes merged
 * - Loading/error states
 * This ensures that local edits to name/description are immediately visible in UI
 */
export const testsetMetadataAtom = atom((get): TestsetMetadata | null => {
    const revisionQuery = get(revisionQueryAtom)
    const variantQuery = get(variantDetailQueryAtom)
    const currentRevisionId = get(currentRevisionIdAtom)

    const revisionFromQuery = revisionQuery.data
    // For new testsets, testset_id is empty but we still want to show metadata
    const isNewTestset = currentRevisionId === "new" || currentRevisionId === "draft"
    if (!revisionFromQuery?.testset_id && !isNewTestset) return null

    // Get draft if any (for name/description edits)
    const draft =
        currentRevisionId && currentRevisionId === revisionFromQuery?.id
            ? get(revisionDraftAtomFamily(currentRevisionId))
            : null

    // Merge draft with server data (for new testsets, revisionFromQuery may have empty fields)
    const revision = draft ? {...(revisionFromQuery ?? {}), ...draft} : revisionFromQuery

    const variant = variantQuery.data

    // Priority order for name/description:
    // 1. Draft (local edits)
    // 2. Variant (server data - variants contain name/description, not revisions)
    const effectiveName = revision?.name || variant?.name || ""
    const effectiveDescription = revision?.description || variant?.description || undefined

    return {
        testsetId: revisionFromQuery?.testset_id ?? "",
        testsetName: effectiveName,
        testsetSlug: undefined, // slug is not in current schema
        revisionSlug: revision?.slug ?? undefined,
        revisionVersion: revision?.version ?? revisionFromQuery?.version,
        description: effectiveDescription,
        commitMessage: revision?.message ?? undefined,
        author: revision?.author ?? undefined,
        createdAt: revision?.created_at ?? undefined,
        updatedAt: revision?.updated_at ?? undefined,
    }
})

/**
 * Loading state for all metadata queries
 */
export const metadataLoadingAtom = atom((get) => {
    const revisionQuery = get(revisionQueryAtom)
    const variantQuery = get(variantDetailQueryAtom)
    return revisionQuery.isPending || variantQuery.isPending
})

/**
 * Error state for metadata queries
 */
export const metadataErrorAtom = atom((get) => {
    const revisionQuery = get(revisionQueryAtom)
    const variantQuery = get(variantDetailQueryAtom)
    return (revisionQuery.error || variantQuery.error) as Error | null
})
