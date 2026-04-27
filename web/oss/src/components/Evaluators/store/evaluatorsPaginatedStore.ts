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
import {atom, type Atom} from "jotai"

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
// SHARED HELPERS
// ============================================================================

const emptyFetchResult = <TRow>(
    totalCount: number | null = null,
): InfiniteTableFetchResult<TRow> => ({
    rows: [],
    totalCount,
    hasMore: false,
    nextCursor: null,
    nextOffset: null,
    nextWindowing: null,
})

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

const getCursorOffset = (cursor: string | null | undefined) =>
    cursor ? Number.parseInt(cursor, 10) || 0 : 0

const compareDeletedAtDesc = (a: EvaluatorTableRow, b: EvaluatorTableRow) => {
    const aTime = a.deletedAt ? Date.parse(a.deletedAt) : 0
    const bTime = b.deletedAt ? Date.parse(b.deletedAt) : 0
    return bTime - aTime
}

const createEvaluatorMetaAtom = (
    categoryAtom: Atom<EvaluatorCategory>,
    searchTermAtom: Atom<string>,
) =>
    atom<EvaluatorQueryMeta>((get) => ({
        projectId: get(projectIdAtom),
        category: get(categoryAtom),
        searchTerm: get(searchTermAtom) || undefined,
    }))

const toRevisionEvaluatorRow = (revision: Workflow): EvaluatorTableRow => {
    const workflowId = revision.workflow_id ?? ""

    return {
        key: revision.id,
        revisionId: revision.id,
        workflowId,
        variantId: revision.workflow_variant_id ?? revision.variant_id ?? "",
        version: revision.version ?? null,
        revisionCreatedAt: revision.created_at ?? null,
    }
}

const toArchivedEvaluatorRow = (workflow: Workflow, revision: Workflow): EvaluatorTableRow => ({
    key: workflow.id,
    revisionId: revision.id,
    workflowId: workflow.id,
    variantId: revision.workflow_variant_id ?? revision.variant_id ?? "",
    version: revision.version ?? null,
    revisionCreatedAt: revision.created_at ?? null,
    deletedAt: workflow.deleted_at ?? null,
    deletedById: workflow.deleted_by_id ?? null,
})

// ============================================================================
// META ATOM
// ============================================================================

const evaluatorPaginatedMetaAtom = createEvaluatorMetaAtom(
    evaluatorCategoryAtom,
    evaluatorSearchTermAtom,
)

// ============================================================================
// EVALUATOR WORKFLOW CACHE
// ============================================================================

/**
 * Lightweight cache of evaluator workflows per mode+category+project.
 * Active lists use the workflow IDs to page revisions server-side.
 * Archived lists use the richer entries because deleted metadata lives on the
 * workflow row, not on the latest revision row.
 *
 * Workflow entities are seeded into workflowMolecule by their ID so that
 * group parent rows (which look up by workflowId) can read name/slug without
 * triggering individual revision fetches.
 *
 * Category classification (automatic vs human) is derived from the latest revision's
 * URI/flags — workflow-level flags only have is_evaluator, not is_feedback.
 */
interface EvaluatorWorkflowCacheEntry {
    workflow: Workflow
    latestRevision: Workflow | null
}

interface EvaluatorWorkflowCache {
    key: string // `${projectId}:${category}:${mode}:${searchTerm}`
    workflowIds: string[]
    entries: EvaluatorWorkflowCacheEntry[]
}

let _evaluatorWorkflowCache = new Map<string, EvaluatorWorkflowCache>()

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

async function ensureEvaluatorWorkflowCache({
    projectId,
    category,
    searchTerm,
    mode,
}: {
    projectId: string
    category: EvaluatorCategory
    searchTerm?: string
    mode: EvaluatorsTableMode
}): Promise<EvaluatorWorkflowCache> {
    const cacheKey = `${projectId}:${category}:${mode}:${searchTerm ?? ""}`
    const cached = _evaluatorWorkflowCache.get(cacheKey)
    if (cached) {
        return cached
    }

    const workflowsResponse = await queryWorkflows({
        projectId,
        flags: {is_evaluator: true as const},
        name: searchTerm || undefined,
        includeArchived: mode === "archived",
    })
    const workflows = (workflowsResponse.workflows ?? []).filter((workflow) =>
        mode === "archived" ? Boolean(workflow.deleted_at) : !workflow.deleted_at,
    )

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

    const entries = workflows.flatMap((workflow) => {
        const revision = latestRevisions.get(workflow.id) ?? null

        if (revision) {
            workflowMolecule.set.seedEntity(revision.id, revision)
        }

        const isHuman = isHumanEvaluator(revision)
        if (category === "human" ? !isHuman : isHuman) {
            return [] as EvaluatorWorkflowCacheEntry[]
        }

        return [{workflow, latestRevision: revision}]
    })

    const cache = {
        key: cacheKey,
        workflowIds: entries.map((entry) => entry.workflow.id),
        entries,
    }

    _evaluatorWorkflowCache.set(cacheKey, cache)
    return cache
}

/** Clear caches so the next fetch re-queries the API. */
export const clearEvaluatorWorkflowCache = () => {
    _evaluatorWorkflowCache.clear()
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

async function buildArchivedEvaluatorRows(meta: EvaluatorQueryMeta): Promise<EvaluatorTableRow[]> {
    if (!meta.projectId) return []

    const cache = await ensureEvaluatorWorkflowCache({
        projectId: meta.projectId,
        category: meta.category,
        searchTerm: meta.searchTerm,
        mode: "archived",
    })

    return cache.entries
        .flatMap(({workflow, latestRevision}) => {
            const revision = latestRevision
            if (!revision) return [] as EvaluatorTableRow[]

            return [toArchivedEvaluatorRow(workflow, revision)]
        })
        .sort(compareDeletedAtDesc)
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
            return emptyFetchResult<Workflow>()
        }

        const cache = await ensureEvaluatorWorkflowCache({
            projectId: meta.projectId,
            category: meta.category,
            searchTerm: meta.searchTerm,
            mode: "active",
        })

        if (cache.workflowIds.length === 0) {
            return emptyFetchResult<Workflow>(0)
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
    transformRow: toRevisionEvaluatorRow,
    isEnabled: (meta) => Boolean(meta?.projectId),
    listCountsConfig: {
        totalCountMode: "unknown",
    },
})

const archivedEvaluatorCategoryAtom = atom<EvaluatorCategory>("automatic")
const archivedEvaluatorSearchTermAtom = atom("")

const archivedEvaluatorPaginatedMetaAtom = createEvaluatorMetaAtom(
    archivedEvaluatorCategoryAtom,
    archivedEvaluatorSearchTermAtom,
)

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
            return emptyFetchResult<EvaluatorTableRow>()
        }

        const archivedRows = await buildArchivedEvaluatorRows(meta)
        const offset = getCursorOffset(cursor)
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
