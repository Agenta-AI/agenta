/**
 * Evaluators Paginated Store
 *
 * Provides paginated fetching for evaluator revisions with IVT integration.
 * Evaluators are workflows with `flags.is_evaluator === true`.
 *
 * Rows are revision-level (not workflow-level) so each row has access to
 * `data` (uri, schemas, parameters). This follows the same pattern as the
 * registry variants table in `VariantsComponents/store/registryStore.ts`.
 *
 * Since each evaluator workflow currently has a single variant, the table
 * supports a 2-level structure: evaluator (workflow) → revisions.
 */

import {createPaginatedEntityStore} from "@agenta/entities/shared"
import type {InfiniteTableFetchResult, WindowingState} from "@agenta/entities/shared"
import type {Workflow} from "@agenta/entities/workflow"
import {
    queryWorkflows,
    queryWorkflowRevisionsByWorkflows,
    parseWorkflowKeyFromUri,
    resolveOutputSchemaProperties,
} from "@agenta/entities/workflow"
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
    // Core IDs
    revisionId: string
    workflowId: string
    variantId: string
    // Display fields (pre-computed from revision data)
    name: string
    slug: string
    version: number | null
    /** Evaluator key parsed from URI (e.g., "auto_exact_match") */
    evaluatorKey: string | null
    /** Raw URI from revision data */
    uri: string | null
    /** Output schema properties — used for feedback column (human evaluators) */
    outputProperties: Record<string, unknown> | null
    /** Template tags resolved from evaluator key */
    tags: string[]
    createdAt: string | null
    updatedAt: string | null
    createdById: string | null
    updatedById: string | null
    /** Revision's own created_at (for child rows in grouped view) */
    revisionCreatedAt: string | null
    /** Commit message from the revision */
    commitMessage: string | null
    /** Raw workflow revision for actions */
    raw: Workflow
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
    name: "",
    slug: "",
    version: null,
    evaluatorKey: null,
    uri: null,
    outputProperties: null,
    tags: [],
    createdAt: null,
    updatedAt: null,
    createdById: null,
    updatedById: null,
    revisionCreatedAt: null,
    commitMessage: null,
    raw: {} as Workflow,
    key: "",
}

// ============================================================================
// WORKFLOW METADATA CACHE
// ============================================================================

/**
 * Cache workflow metadata (name, slug, timestamps) per category.
 * Fetched once on first page request, reused across all pages.
 * Also stores the list of workflow IDs needed for revision queries.
 */
interface WorkflowCacheEntry {
    name: string
    slug: string
    createdAt: string | null
    updatedAt: string | null
    createdById: string | null
    updatedById: string | null
}

interface EvaluatorWorkflowCache {
    key: string // `${projectId}:${category}`
    workflowIds: string[]
    map: Map<string, WorkflowCacheEntry>
}

let _workflowCache: EvaluatorWorkflowCache | null = null

/** Clear caches so the next fetch re-queries the API. */
export const clearEvaluatorWorkflowNameCache = () => {
    _workflowCache = null
}

/** @deprecated Use clearEvaluatorWorkflowNameCache instead */
export const clearEvaluatorRevisionCache = clearEvaluatorWorkflowNameCache

/**
 * Ensure evaluator workflow metadata is cached for the given category.
 * Returns the cached workflow IDs.
 */
async function ensureWorkflowCache(
    projectId: string,
    category: EvaluatorCategory,
): Promise<string[]> {
    const cacheKey = `${projectId}:${category}`
    if (_workflowCache?.key === cacheKey) {
        return _workflowCache.workflowIds
    }

    const flags =
        category === "human"
            ? {is_evaluator: true as const, is_human: true as const}
            : {is_evaluator: true as const, is_human: false as const}

    const workflowsResponse = await queryWorkflows({projectId, flags})
    const workflows = (workflowsResponse.workflows ?? []).filter((w) => !w.deleted_at)

    const map = new Map<string, WorkflowCacheEntry>()
    const workflowIds: string[] = []
    for (const w of workflows) {
        workflowIds.push(w.id)
        map.set(w.id, {
            name: w.name ?? w.slug ?? w.id,
            slug: w.slug ?? "",
            createdAt: w.created_at ?? null,
            updatedAt: w.updated_at ?? null,
            createdById: w.created_by_id ?? null,
            updatedById: w.updated_by_id ?? null,
        })
    }

    _workflowCache = {key: cacheKey, workflowIds, map}
    return workflowIds
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

        // Ensure workflow metadata is cached (lightweight, one-time per category)
        const workflowIds = await ensureWorkflowCache(meta.projectId, meta.category)

        if (workflowIds.length === 0) {
            return {
                rows: [],
                totalCount: 0,
                hasMore: false,
                nextCursor: null,
                nextOffset: null,
                nextWindowing: null,
            }
        }

        // Query revisions across all evaluator workflows with cursor-based pagination
        const windowing: WindowingState = {
            next: cursor,
            limit,
            order: "descending",
        }

        const response = await queryWorkflowRevisionsByWorkflows(
            workflowIds,
            meta.projectId,
            undefined,
            windowing,
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
        const variantId = apiRow.workflow_variant_id ?? apiRow.variant_id ?? ""
        const cached = _workflowCache?.map.get(workflowId)
        const name = cached?.name ?? apiRow.name ?? workflowId ?? "-"
        const slug = cached?.slug ?? apiRow.slug ?? ""

        const uri = apiRow.data?.uri ?? null
        const evaluatorKey = parseWorkflowKeyFromUri(uri)

        const outputProperties = resolveOutputSchemaProperties(apiRow.data)

        return {
            key: apiRow.id,
            revisionId: apiRow.id,
            workflowId,
            variantId,
            name,
            slug,
            version: apiRow.version ?? null,
            evaluatorKey,
            uri,
            outputProperties,
            tags: [],
            createdAt: cached?.createdAt ?? apiRow.created_at ?? null,
            updatedAt: cached?.updatedAt ?? apiRow.updated_at ?? null,
            createdById: cached?.createdById ?? apiRow.created_by_id ?? null,
            updatedById: cached?.updatedById ?? apiRow.updated_by_id ?? null,
            revisionCreatedAt: apiRow.created_at ?? null,
            commitMessage: apiRow.message ?? null,
            raw: apiRow,
        }
    },
    isEnabled: (meta) => Boolean(meta?.projectId),
    listCountsConfig: {
        totalCountMode: "unknown",
    },
})
