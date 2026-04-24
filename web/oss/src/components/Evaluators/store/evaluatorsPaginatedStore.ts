/**
 * Evaluators Paginated Store
 *
 * Provides paginated fetching for evaluator revisions with IVT integration.
 * Evaluators are workflows with `flags.is_evaluator === true`.
 *
 * Rows carry IDs and bare sorting/grouping fields only.
 * All display data (name, slug, evaluatorKey, outputProperties, etc.)
 * is read from workflowMolecule per revisionId inside cell renderers.
 *
 * Since each evaluator workflow currently has a single variant, the table
 * supports a 2-level structure: evaluator (workflow) → revisions.
 */

import {createPaginatedEntityStore} from "@agenta/entities/shared"
import type {InfiniteTableFetchResult} from "@agenta/entities/shared"
import type {Workflow} from "@agenta/entities/workflow"
import {
    queryWorkflows,
    queryWorkflowRevisionsByWorkflows,
    fetchWorkflowsBatch,
    workflowMolecule,
    onEvaluatorMutation,
} from "@agenta/entities/workflow"
import {queryClient} from "@agenta/shared/api"
import {projectIdAtom} from "@agenta/shared/state"
import {atom} from "jotai"

import type {EvaluatorCategory} from "../assets/types"

import {evaluatorCategoryAtom, evaluatorSearchTermAtom} from "./evaluatorFilterAtoms"

// ============================================================================
// TABLE ROW TYPE
// ============================================================================

export interface EvaluatorTableRow {
    key: string
    __isSkeleton?: boolean
    /** Grouping markers for IVT tree data */
    __isEvaluatorGroup?: boolean
    __isGroupChild?: boolean
    __revisionCount?: number
    // Core IDs — used as molecule keys by cell renderers
    revisionId: string
    workflowId: string
    variantId: string
    // Bare fields needed for grouping/sorting only — all display data comes from molecules
    version: number | null
    /** Revision's own created_at — used for child row date sort */
    revisionCreatedAt: string | null
    deletedAt?: string | null
    deletedById?: string | null
    [k: string]: unknown
}

// ============================================================================
// QUERY META
// ============================================================================

interface EvaluatorQueryMeta {
    projectId: string | null
    category: EvaluatorCategory
    searchTerm?: string
}

export type EvaluatorsTableMode = "active" | "archived"

// ============================================================================
// META ATOM
// ============================================================================

const evaluatorPaginatedMetaAtom = atom<EvaluatorQueryMeta>((get) => ({
    projectId: get(projectIdAtom),
    category: get(evaluatorCategoryAtom),
    searchTerm: get(evaluatorSearchTermAtom) || undefined,
}))

const skeletonDefaults: Partial<EvaluatorTableRow> = {
    revisionId: "",
    workflowId: "",
    variantId: "",
    version: null,
    revisionCreatedAt: null,
    deletedAt: null,
    deletedById: null,
    key: "",
}

// ============================================================================
// WORKFLOW ID CACHE
// ============================================================================

/**
 * Lightweight cache of workflow IDs per category+project.
 * Used only to know which workflow IDs to pass to the revisions query.
 *
 * Workflow entities are seeded into workflowMolecule by their ID so that
 * group parent rows (which look up by workflowId) can read name/slug without
 * triggering individual revision fetches.
 *
 * Category classification (auto vs human) is derived from the latest revision's
 * URI/flags — workflow-level flags only have is_evaluator, not is_feedback.
 */
interface WorkflowIdCache {
    key: string // `${projectId}:${category}:${searchTerm}`
    workflowIds: string[]
}

let _workflowIdCache: WorkflowIdCache | null = null

/**
 * Determine if a workflow revision represents a "human" evaluator.
 * Checks the URI key first (source of truth), then falls back to flags.
 */
function isHumanEvaluator(revision: Workflow | null | undefined): boolean {
    if (!revision) return false
    const uri = revision.data?.uri
    if (uri) {
        return uri.split(":")[2] === "feedback"
    }
    return Boolean(revision.flags?.is_feedback)
}

async function ensureWorkflowIdCache(
    projectId: string,
    category: EvaluatorCategory,
    searchTerm?: string,
): Promise<WorkflowIdCache> {
    const cacheKey = `${projectId}:${category}:${searchTerm ?? ""}`
    if (_workflowIdCache?.key === cacheKey) {
        return _workflowIdCache
    }

    const workflowsResponse = await queryWorkflows({
        projectId,
        flags: {is_evaluator: true as const},
        name: searchTerm || undefined,
    })
    const workflows = (workflowsResponse.workflows ?? []).filter((w) => !w.deleted_at)

    const allWorkflowIds = workflows.map((w) => w.id)

    // Seed all workflow entities for group parent rows
    for (const w of workflows) {
        workflowMolecule.set.seedEntity(w.id, w)
    }

    // Fetch latest revision for each workflow to classify by category.
    // Workflow-level flags only have is_evaluator — type-specific flags
    // (is_feedback, is_custom, etc.) only exist at the revision level.
    const latestRevisions =
        allWorkflowIds.length > 0
            ? await fetchWorkflowsBatch(projectId, allWorkflowIds)
            : new Map<string, Workflow>()

    const workflowIds = allWorkflowIds.filter((id) => {
        const revision = latestRevisions.get(id)
        const isHuman = isHumanEvaluator(revision)
        return category === "human" ? isHuman : !isHuman
    })

    _workflowIdCache = {key: cacheKey, workflowIds}
    return _workflowIdCache
}

/** Clear caches so the next fetch re-queries the API. */
export const clearEvaluatorWorkflowCache = () => {
    _workflowIdCache = null
    // Also remove TanStack Query entries so the paginated store
    // re-fetches from the API instead of returning cached data.
    queryClient.removeQueries({queryKey: ["evaluator-paginated"], exact: false})
}

/**
 * Full invalidation: clear workflow ID cache + refresh the paginated store.
 * Can be called from anywhere (e.g., after creating/updating/deleting evaluators)
 * without needing a React component callback chain.
 */
export function invalidateEvaluatorsPaginatedStore() {
    clearEvaluatorWorkflowCache()
    evaluatorsPaginatedStore.invalidate()
}

async function queryArchivedEvaluatorRows(meta: EvaluatorQueryMeta): Promise<EvaluatorTableRow[]> {
    if (!meta.projectId) return []

    const response = await queryWorkflows({
        projectId: meta.projectId,
        flags: {is_evaluator: true as const},
        name: meta.searchTerm || undefined,
        includeArchived: true,
    })

    const archivedWorkflows = (response.workflows ?? []).filter((workflow) =>
        Boolean(workflow.deleted_at),
    )

    for (const workflow of archivedWorkflows) {
        workflowMolecule.set.seedEntity(workflow.id, workflow)
    }

    const latestRevisions =
        archivedWorkflows.length > 0
            ? await fetchWorkflowsBatch(
                  meta.projectId,
                  archivedWorkflows.map((workflow) => workflow.id),
              )
            : new Map<string, Workflow>()

    const rows = archivedWorkflows.flatMap((workflow) => {
        const revision = latestRevisions.get(workflow.id)
        if (!revision) return [] as EvaluatorTableRow[]

        workflowMolecule.set.seedEntity(revision.id, revision)

        const isHuman = isHumanEvaluator(revision)
        if (meta.category === "human" ? !isHuman : isHuman) {
            return [] as EvaluatorTableRow[]
        }

        return [
            {
                key: workflow.id,
                revisionId: revision.id,
                workflowId: workflow.id,
                variantId: revision.workflow_variant_id ?? revision.variant_id ?? "",
                version: revision.version ?? null,
                revisionCreatedAt: revision.created_at ?? null,
                deletedAt: workflow.deleted_at ?? null,
                deletedById: workflow.deleted_by_id ?? null,
            },
        ]
    })

    rows.sort((a, b) => {
        const aTime = a.deletedAt ? Date.parse(a.deletedAt) : 0
        const bTime = b.deletedAt ? Date.parse(b.deletedAt) : 0
        return bTime - aTime
    })

    return rows
}

// ============================================================================
// PAGINATED STORE
// ============================================================================

export const evaluatorsPaginatedStore = createPaginatedEntityStore<
    EvaluatorTableRow,
    Workflow,
    EvaluatorQueryMeta
>({
    entityName: "evaluator",
    metaAtom: evaluatorPaginatedMetaAtom,
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

        const cache = await ensureWorkflowIdCache(meta.projectId, meta.category, meta.searchTerm)

        if (cache.workflowIds.length === 0) {
            return {
                rows: [],
                totalCount: 0,
                hasMore: false,
                nextCursor: null,
                nextOffset: null,
                nextWindowing: null,
            }
        }

        const response = await queryWorkflowRevisionsByWorkflows(
            cache.workflowIds,
            meta.projectId,
            {is_evaluator: true},
            {next: cursor ?? undefined, limit: limit ?? undefined, order: "descending"},
            meta.searchTerm,
        )

        // Filter out v0 revisions (auto-created initial revisions)
        const revisions = response.workflow_revisions.filter((r) => (r.version ?? 0) > 0)

        return {
            rows: revisions,
            totalCount: response.count
                ? response.count - (response.workflow_revisions.length - revisions.length)
                : null,
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
    transformRow: (apiRow): EvaluatorTableRow => {
        const workflowId = apiRow.workflow_id ?? ""
        return {
            key: apiRow.id,
            revisionId: apiRow.id,
            workflowId,
            variantId: apiRow.workflow_variant_id ?? apiRow.variant_id ?? "",
            version: apiRow.version ?? null,
            revisionCreatedAt: apiRow.created_at ?? null,
        }
    },
    isEnabled: (meta) => Boolean(meta?.projectId),
    listCountsConfig: {
        totalCountMode: "unknown",
    },
})

const archivedEvaluatorCategoryAtom = atom<EvaluatorCategory>("automatic")
const archivedEvaluatorSearchTermAtom = atom("")

const archivedEvaluatorPaginatedMetaAtom = atom<EvaluatorQueryMeta>((get) => ({
    projectId: get(projectIdAtom),
    category: get(archivedEvaluatorCategoryAtom),
    searchTerm: get(archivedEvaluatorSearchTermAtom) || undefined,
}))

const archivedEvaluatorsPaginatedStore = createPaginatedEntityStore<
    EvaluatorTableRow,
    EvaluatorTableRow,
    EvaluatorQueryMeta
>({
    entityName: "archived-evaluator",
    metaAtom: archivedEvaluatorPaginatedMetaAtom,
    fetchPage: async ({
        meta,
        limit,
        cursor,
    }): Promise<InfiniteTableFetchResult<EvaluatorTableRow>> => {
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

        const archivedRows = await queryArchivedEvaluatorRows(meta)
        const offset = cursor ? Number.parseInt(cursor, 10) || 0 : 0
        const rows = archivedRows.slice(offset, offset + limit)
        const nextOffset = offset + rows.length

        return {
            rows,
            totalCount: archivedRows.length,
            hasMore: nextOffset < archivedRows.length,
            nextCursor: nextOffset < archivedRows.length ? String(nextOffset) : null,
            nextOffset: null,
            nextWindowing: null,
        }
    },
    rowConfig: {
        getRowId: (row) => row.revisionId || row.workflowId,
        skeletonDefaults,
    },
    transformRow: (row) => row,
    isEnabled: (meta) => Boolean(meta?.projectId),
    listCountsConfig: {
        totalCountMode: "unknown",
    },
})

export function invalidateEvaluatorManagementQueries() {
    clearEvaluatorWorkflowCache()
    evaluatorsPaginatedStore.invalidate()
    archivedEvaluatorsPaginatedStore.invalidate()
}

export function getEvaluatorsTableState(mode: EvaluatorsTableMode = "active") {
    if (mode === "archived") {
        return {
            mode,
            categoryAtom: archivedEvaluatorCategoryAtom,
            searchTermAtom: archivedEvaluatorSearchTermAtom,
            paginatedStore: archivedEvaluatorsPaginatedStore,
            invalidate: archivedEvaluatorsPaginatedStore.invalidate,
        }
    }

    return {
        mode,
        categoryAtom: evaluatorCategoryAtom,
        searchTermAtom: evaluatorSearchTermAtom,
        paginatedStore: evaluatorsPaginatedStore,
        invalidate: invalidateEvaluatorsPaginatedStore,
    }
}

// Auto-refresh when evaluators are created/updated/deleted.
// The entity package fires this after any evaluator mutation.
onEvaluatorMutation(() => {
    invalidateEvaluatorManagementQueries()
})
