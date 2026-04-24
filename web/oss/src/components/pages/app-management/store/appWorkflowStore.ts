/**
 * Workflow Paginated Store
 *
 * Provides paginated fetching for workflows (apps + evaluators) with IVT integration.
 * Filter selection is driven by `workflowTypeFilterAtom` so a single store instance
 * can power both the app-management table ("app") and the evaluation-creation modal
 * ("all" | "app" | "evaluator" | subcategory).
 */

import {createPaginatedEntityStore} from "@agenta/entities/shared"
import type {InfiniteTableFetchResult} from "@agenta/entities/shared"
import {
    deriveWorkflowTypeFromRevision,
    fetchWorkflowsBatch,
    parseWorkflowKeyFromUri,
    queryWorkflows,
} from "@agenta/entities/workflow"
import type {Workflow, WorkflowType} from "@agenta/entities/workflow"
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
    /** Derived workflow type when known (from the latest revision). Populated in
     * the invokable-only path; undefined otherwise. */
    workflowType?: WorkflowType
    /** Workflow key parsed from the latest revision URI (e.g. "auto_exact_match").
     * Used to look up the evaluator template name/color for the Type column. */
    workflowKey?: string | null
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
 * The workflow list endpoint accepts `WorkflowQueryFlags` which includes the
 * revision-level flags via JSONB containment on the latest revision. Flags
 * that can't be expressed positively (e.g. "completion" = "not chat and not
 * custom") are resolved client-side from the derived `WorkflowType` once
 * revisions are fetched — see `deriveFilterWorkflowType`.
 */
const buildFlagsFilter = (type: WorkflowTypeFilter): Record<string, boolean> | undefined => {
    switch (type) {
        case "app":
            return {is_evaluator: false}
        case "evaluator":
            return {is_evaluator: true}
        case "chat":
            return {is_evaluator: false, is_chat: true}
        case "custom":
            return {is_evaluator: false, is_custom: true}
        case "completion":
            // No positive flag — filter client-side via derived type.
            return {is_evaluator: false}
        case "llm":
            return {is_evaluator: true, is_llm: true}
        case "match":
            return {is_evaluator: true, is_match: true}
        case "code":
            return {is_evaluator: true, is_code: true}
        case "hook":
            return {is_evaluator: true, is_hook: true}
        case "all":
        default:
            return undefined
    }
}

/** Subset of filter values that map 1:1 to a derived `WorkflowType`. */
const FILTER_TYPE_MAP: Partial<Record<WorkflowTypeFilter, WorkflowType>> = {
    chat: "chat",
    completion: "completion",
    custom: "custom",
    llm: "llm",
    match: "match",
    code: "code",
    hook: "hook",
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

interface InvokableEntry {
    workflow: Workflow
    revision: Workflow
    workflowType: WorkflowType
}

/**
 * Narrows a list of workflows to those that can be invoked as an evaluation
 * subject. Fetches latest revisions in bulk and filters out:
 * - human evaluators (`is_feedback=true`)
 * - workflows without a runnable URL (`has_url=false` or unset)
 *
 * Also pairs each surviving workflow with its derived `WorkflowType` so the
 * caller can apply subcategory filters without re-reading revisions.
 */
const filterInvokableWorkflows = async (
    projectId: string,
    workflows: Workflow[],
): Promise<InvokableEntry[]> => {
    if (workflows.length === 0) return []
    const latestByWorkflowId = await fetchWorkflowsBatch(
        projectId,
        workflows.map((w) => w.id),
    )
    const entries: InvokableEntry[] = []
    for (const workflow of workflows) {
        const revision = latestByWorkflowId.get(workflow.id)
        if (!revision) continue
        if (isHumanEvaluator(revision)) continue
        if (!revision.flags?.has_url) continue
        entries.push({
            workflow,
            revision,
            workflowType: deriveWorkflowTypeFromRevision(revision, {
                // Revisions returned by `fetchWorkflowsBatch` don't always
                // carry `is_evaluator`; the artifact (from `queryWorkflows`)
                // is the source of truth for the role flag.
                isEvaluator: Boolean(workflow.flags?.is_evaluator),
            }),
        })
    }
    return entries
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

/** Workflow row carrying optional derived metadata, populated in the
 *  invokable-only path where we already fetch latest revisions. */
type EnrichedWorkflow = Workflow & {
    _derivedType?: WorkflowType
    _workflowKey?: string | null
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
    EnrichedWorkflow,
    AppWorkflowQueryMeta
>({
    entityName: "appWorkflow",
    metaAtom: appWorkflowMetaAtom,
    fetchPage: async ({
        meta,
        limit,
        cursor,
    }): Promise<InfiniteTableFetchResult<EnrichedWorkflow>> => {
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
            const targetType = FILTER_TYPE_MAP[meta.typeFilter]
            const narrowed = targetType
                ? invokable.filter((entry) => entry.workflowType === targetType)
                : invokable
            const enriched: EnrichedWorkflow[] = narrowed.map((entry) =>
                Object.assign({}, entry.workflow, {
                    _derivedType: entry.workflowType,
                    _workflowKey:
                        parseWorkflowKeyFromUri(entry.revision.data?.uri) ?? entry.revision.slug,
                }),
            )

            const offset = cursor ? Number.parseInt(cursor, 10) || 0 : 0
            const pageSize = limit ?? 50
            const page = enriched.slice(offset, offset + pageSize)
            const nextOffset = offset + pageSize
            const hasMore = nextOffset < enriched.length

            return {
                rows: page,
                totalCount: enriched.length,
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
        workflowType: apiRow._derivedType,
        workflowKey: apiRow._workflowKey,
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
            const targetType = FILTER_TYPE_MAP[typeFilter]
            const narrowed = targetType
                ? invokable.filter((entry) => entry.workflowType === targetType)
                : invokable
            return narrowed.length
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
            const targetType = FILTER_TYPE_MAP[typeFilter]
            const narrowed = targetType
                ? invokable.filter((entry) => entry.workflowType === targetType)
                : invokable
            return narrowed.length
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
