/**
 * Workflow Paginated Store
 *
 * Provides paginated fetching for workflows (apps + evaluators) with IVT integration.
 * Filter selection is driven by `workflowTypeFilterAtom` so a single store instance
 * can power both the app-management table ("app") and the evaluation-creation modal
 * ("all" | "app" | "evaluator").
 */

import {createPaginatedEntityStore} from "@agenta/entities/shared"
import type {InfiniteTableFetchResult} from "@agenta/entities/shared"
import {fetchWorkflowsBatch, queryWorkflows} from "@agenta/entities/workflow"
import type {Workflow} from "@agenta/entities/workflow"
import {queryClient} from "@agenta/shared/api"
import {projectIdAtom} from "@agenta/shared/state"
import {atom} from "jotai"
import {atomWithQuery} from "jotai-tanstack-query"

import {
    appWorkflowSearchTermAtom,
    workflowInvokableOnlyAtom,
    workflowTypeFilterAtom,
    type WorkflowTypeFilter,
} from "./appWorkflowFilterAtoms"

// ============================================================================
// TABLE ROW TYPE
// ============================================================================

export interface AppWorkflowRow {
    key: string
    __isSkeleton?: boolean
    workflowId: string
    name: string
    appType: string
    isEvaluator: boolean
    updatedAt: string | null
    createdAt: string | null
    [k: string]: unknown
}

// ============================================================================
// FILTER → FLAGS TRANSLATION
// ============================================================================

/**
 * Build the `flags` payload for `queryWorkflows` from the active filter config.
 * Only `is_evaluator` is reliably filtered server-side — the workflow list
 * endpoint accepts `WorkflowArtifactQueryFlags` (artifact-level) which does not
 * include revision-level flags like `has_url`/`is_feedback`. Those are applied
 * client-side after fetching latest revisions (see `filterInvokableWorkflows`).
 */
const buildFlagsFilter = (type: WorkflowTypeFilter): Record<string, boolean> | undefined => {
    if (type === "app") return {is_evaluator: false}
    if (type === "evaluator") return {is_evaluator: true}
    return undefined
}

/**
 * Returns true if the workflow's latest revision indicates it's a human
 * evaluator (URI key `feedback` or `flags.is_feedback === true`). Human
 * evaluators can't be invoked automatically and therefore can't be the
 * subject of an evaluation run.
 */
const isHumanEvaluator = (revision: Workflow | null | undefined): boolean => {
    if (!revision) return false
    const uri = revision.data?.uri as string | undefined
    if (uri) return uri.split(":")[2] === "feedback"
    return Boolean(revision.flags?.is_feedback)
}

/**
 * Narrows a list of workflows to those that can be invoked as an evaluation
 * subject. Fetches latest revisions in bulk and filters out:
 * - human evaluators (`is_feedback=true`)
 * - workflows without a runnable URL (`has_url=false` or unset)
 */
const filterInvokableWorkflows = async (
    projectId: string,
    workflows: Workflow[],
): Promise<Workflow[]> => {
    if (workflows.length === 0) return []
    const latestByWorkflowId = await fetchWorkflowsBatch(
        projectId,
        workflows.map((w) => w.id),
    )
    return workflows.filter((w) => {
        const rev = latestByWorkflowId.get(w.id)
        if (!rev) return false
        if (isHumanEvaluator(rev)) return false
        return Boolean(rev.flags?.has_url)
    })
}

// ============================================================================
// META ATOM
// ============================================================================

interface AppWorkflowQueryMeta {
    projectId: string | null
    searchTerm?: string
    typeFilter: WorkflowTypeFilter
    invokableOnly: boolean
}

const appWorkflowMetaAtom = atom<AppWorkflowQueryMeta>((get) => ({
    projectId: get(projectIdAtom),
    searchTerm: get(appWorkflowSearchTermAtom).trim() || undefined,
    typeFilter: get(workflowTypeFilterAtom),
    invokableOnly: get(workflowInvokableOnlyAtom),
}))

// ============================================================================
// PAGINATED STORE
// ============================================================================

const skeletonDefaults: Partial<AppWorkflowRow> = {
    workflowId: "",
    name: "",
    appType: "",
    isEvaluator: false,
    updatedAt: null,
    createdAt: null,
    key: "",
}

export const appWorkflowPaginatedStore = createPaginatedEntityStore<
    AppWorkflowRow,
    Workflow,
    AppWorkflowQueryMeta
>({
    entityName: "appWorkflow",
    metaAtom: appWorkflowMetaAtom,
    fetchPage: async ({meta, limit, cursor}): Promise<InfiniteTableFetchResult<Workflow>> => {
        if (!meta.projectId) {
            return {
                rows: [],
                totalCount: null,
                hasMore: false,
                nextCursor: null,
                nextOffset: null,
                nextWindowing: null,
            }
        }

        // Invokability filter (has_url=true, is_feedback=false) lives on revision
        // flags, which WorkflowQuery.flags can't carry — pull the full list,
        // filter via latest revisions, then paginate client-side using the
        // cursor as a numeric offset.
        if (meta.invokableOnly) {
            const response = await queryWorkflows({
                projectId: meta.projectId,
                name: meta.searchTerm,
                flags: buildFlagsFilter(meta.typeFilter),
            })
            const all = (response.workflows ?? []).filter((w) => !w.deleted_at)
            const invokable = await filterInvokableWorkflows(meta.projectId, all)

            const offset = cursor ? Number.parseInt(cursor, 10) || 0 : 0
            const pageSize = limit ?? 50
            const page = invokable.slice(offset, offset + pageSize)
            const nextOffset = offset + pageSize
            const hasMore = nextOffset < invokable.length

            return {
                rows: page,
                totalCount: invokable.length,
                hasMore,
                nextCursor: hasMore ? String(nextOffset) : null,
                nextOffset: null,
                nextWindowing: null,
            }
        }

        const response = await queryWorkflows({
            projectId: meta.projectId,
            name: meta.searchTerm,
            flags: buildFlagsFilter(meta.typeFilter),
            windowing: {limit, order: "descending", next: cursor ?? undefined},
        })

        return {
            rows: response.workflows,
            totalCount: response.count ?? null,
            hasMore: !!response.windowing?.next,
            nextCursor: response.windowing?.next ?? null,
            nextOffset: null,
            nextWindowing: null,
        }
    },
    rowConfig: {
        getRowId: (row) => row.id,
        skeletonDefaults,
    },
    transformRow: (apiRow): AppWorkflowRow => ({
        key: apiRow.id,
        workflowId: apiRow.id,
        name: apiRow.name ?? apiRow.slug ?? apiRow.id,
        appType: "",
        isEvaluator: Boolean(apiRow.flags?.is_evaluator),
        updatedAt: apiRow.updated_at ?? apiRow.created_at ?? null,
        createdAt: apiRow.created_at ?? null,
    }),
    isEnabled: (meta) => Boolean(meta?.projectId),
    listCountsConfig: {
        totalCountMode: "unknown",
    },
})

/**
 * Alias reflecting that the store now serves any workflow type, not just apps.
 * Prefer this name in new call sites; `appWorkflowPaginatedStore` is kept for
 * backward compatibility with existing imports.
 */
export const workflowPaginatedStore = appWorkflowPaginatedStore

// ============================================================================
// COUNT ATOM
// ============================================================================

/**
 * Lightweight query atom that fetches the unfiltered total count for the active
 * workflow type filter. Discards workflow data to avoid duplicating state with
 * the paginated store. Temporary until the backend provides an optimized count
 * endpoint.
 */
const appWorkflowTotalCountQueryAtom = atomWithQuery((get) => {
    const projectId = get(projectIdAtom)
    const typeFilter = get(workflowTypeFilterAtom)
    const invokableOnly = get(workflowInvokableOnlyAtom)

    return {
        queryKey: ["appWorkflowTotalCount", projectId, typeFilter, invokableOnly],
        queryFn: async () => {
            if (!projectId) return 0
            const response = await queryWorkflows({
                projectId,
                flags: buildFlagsFilter(typeFilter),
            })
            if (!invokableOnly) {
                return response.count ?? response.workflows.length
            }
            const invokable = await filterInvokableWorkflows(
                projectId,
                (response.workflows ?? []).filter((w) => !w.deleted_at),
            )
            return invokable.length
        },
        enabled: !!projectId,
        staleTime: 30_000,
        refetchOnWindowFocus: false,
    }
})

/**
 * Derived atom exposing the unfiltered total workflow count (0 while loading).
 */
export const appWorkflowTotalCountAtom = atom((get) => {
    const query = get(appWorkflowTotalCountQueryAtom)
    return query.data ?? 0
})

const appWorkflowCountQueryAtom = atomWithQuery((get) => {
    const projectId = get(projectIdAtom)
    const searchTerm = get(appWorkflowSearchTermAtom).trim() || undefined
    const typeFilter = get(workflowTypeFilterAtom)
    const invokableOnly = get(workflowInvokableOnlyAtom)

    return {
        queryKey: ["appWorkflowCount", projectId, typeFilter, invokableOnly, searchTerm ?? null],
        queryFn: async () => {
            if (!projectId) return 0
            const response = await queryWorkflows({
                projectId,
                name: searchTerm,
                flags: buildFlagsFilter(typeFilter),
            })
            if (!invokableOnly) {
                return response.count ?? response.workflows.length
            }
            const invokable = await filterInvokableWorkflows(
                projectId,
                (response.workflows ?? []).filter((w) => !w.deleted_at),
            )
            return invokable.length
        },
        enabled: !!projectId,
        staleTime: 30_000,
        refetchOnWindowFocus: false,
    }
})

/**
 * Derived atom exposing the search-filtered workflow count (0 while loading).
 */
export const appWorkflowCountAtom = atom((get) => {
    const query = get(appWorkflowCountQueryAtom)
    return query.data ?? 0
})

/**
 * Refreshes all app-management-specific app caches:
 * - paginated applications table
 * - unfiltered applications count
 * - search-filtered applications count
 */
export async function invalidateAppManagementWorkflowQueries() {
    appWorkflowPaginatedStore.invalidate()

    await Promise.all([
        queryClient.invalidateQueries({queryKey: ["appWorkflowTotalCount"], exact: false}),
        queryClient.invalidateQueries({queryKey: ["appWorkflowCount"], exact: false}),
    ])
}
