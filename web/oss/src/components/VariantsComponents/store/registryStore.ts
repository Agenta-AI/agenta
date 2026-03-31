/**
 * Registry Paginated Store
 *
 * Provides paginated fetching for workflow revisions with IVT integration.
 * Uses cursor-based pagination via the backend's Windowing model.
 */

import {createPaginatedEntityStore} from "@agenta/entities/shared"
import type {InfiniteTableFetchResult, WindowingState} from "@agenta/entities/shared"
import {queryWorkflowRevisionsByWorkflow, queryWorkflowVariants} from "@agenta/entities/workflow"
import type {Workflow} from "@agenta/entities/workflow"
import {projectIdAtom} from "@agenta/shared/state"
import {atom} from "jotai"

import {routerAppIdAtom} from "@/oss/state/app/selectors/app"

import {registrySearchTermAtom} from "./registryFilterAtoms"

// ============================================================================
// WORKFLOW ID OVERRIDE
// ============================================================================

/**
 * Override atom for the workflow ID used by the registry store.
 * When set, takes precedence over `routerAppIdAtom`.
 * Used by the new evaluation modal on project-level pages where no app is in the URL.
 */
export const registryWorkflowIdOverrideAtom = atom<string | null>(null)

// ============================================================================
// TABLE ROW TYPE
// ============================================================================

export interface RegistryRevisionRow {
    key: string
    __isSkeleton?: boolean
    // Core IDs — passed to molecule selectors by cells
    revisionId: string
    workflowId: string
    variantId: string
    variantName: string
    // Bare fields needed for sorting/grouping only
    version: number | null
    /** Pre-computed model name (scalar, extracted from parameters in transformRow) */
    model: string
    /** Revision's own created_at — used for date sort */
    createdAt: string | null
    [k: string]: unknown
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Recursively picks the model name from a parameters object.
 * Reused from getVariantColumns.tsx logic.
 */
const pickModelFromParams = (value: unknown, depth = 0, visited = new Set<unknown>()): string => {
    if (!value || depth > 6) return ""
    if (visited.has(value)) return ""
    if (typeof value === "object") visited.add(value)

    if (typeof value === "string") {
        return value.trim()
    }

    if (Array.isArray(value)) {
        for (const item of value) {
            const result = pickModelFromParams(item, depth + 1, visited)
            if (result) return result
        }
        return ""
    }

    if (typeof value === "object") {
        const obj = value as Record<string, unknown>
        const directModel = [obj.model, obj.model_name, obj.modelName, obj.engine].find(
            (candidate) => typeof candidate === "string" && candidate.trim().length > 0,
        ) as string | undefined
        if (directModel) return directModel.trim()

        const llmConfig = obj.llm_config ?? obj.llmConfig
        if (llmConfig) {
            const result = pickModelFromParams(llmConfig, depth + 1, visited)
            if (result) return result
        }

        for (const nested of Object.values(obj)) {
            const result = pickModelFromParams(nested, depth + 1, visited)
            if (result) return result
        }
    }

    return ""
}

// ============================================================================
// QUERY META
// ============================================================================

interface RegistryQueryMeta {
    projectId: string | null
    workflowId: string | null
    searchTerm?: string
}

// ============================================================================
// META ATOM
// ============================================================================

const registryPaginatedMetaAtom = atom<RegistryQueryMeta>((get) => ({
    projectId: get(projectIdAtom),
    workflowId: get(registryWorkflowIdOverrideAtom) || get(routerAppIdAtom),
    searchTerm: get(registrySearchTermAtom) || undefined,
}))

// ============================================================================
// PAGINATED STORE
// ============================================================================

const skeletonDefaults: Partial<RegistryRevisionRow> = {
    revisionId: "",
    workflowId: "",
    variantId: "",
    variantName: "",
    version: null,
    model: "",
    createdAt: null,
    key: "",
}

// Cache variant names per workflow to avoid re-fetching on every page
let _variantNameCache: {workflowId: string; map: Map<string, string>} | null = null

/** Clear the variant name cache so the next fetch re-queries variants. */
export const clearRegistryVariantNameCache = () => {
    _variantNameCache = null
}

export const registryPaginatedStore = createPaginatedEntityStore<
    RegistryRevisionRow,
    Workflow,
    RegistryQueryMeta
>({
    entityName: "registryRevision",
    metaAtom: registryPaginatedMetaAtom,
    fetchPage: async ({meta, limit, cursor}): Promise<InfiniteTableFetchResult<Workflow>> => {
        if (!meta.projectId || !meta.workflowId) {
            return {
                rows: [],
                totalCount: null,
                hasMore: false,
                nextCursor: null,
                nextOffset: null,
                nextWindowing: null,
            }
        }

        // Fetch variant names (cached per workflow)
        if (!_variantNameCache || _variantNameCache.workflowId !== meta.workflowId) {
            const variantsResponse = await queryWorkflowVariants(meta.workflowId, meta.projectId)
            const map = new Map<string, string>()
            for (const v of variantsResponse.workflow_variants) {
                map.set(v.id, v.name ?? v.slug ?? v.id)
            }
            _variantNameCache = {workflowId: meta.workflowId, map}
        }

        const windowing: WindowingState = {
            next: cursor,
            limit,
            order: "descending",
        }

        const response = await queryWorkflowRevisionsByWorkflow(
            meta.workflowId,
            meta.projectId,
            undefined,
            windowing,
            meta.searchTerm,
        )

        // Update variant name cache with any new variants found in revisions
        for (const rev of response.workflow_revisions) {
            const vid = rev.workflow_variant_id ?? rev.variant_id
            if (vid && !_variantNameCache.map.has(vid)) {
                _variantNameCache.map.set(vid, rev.name ?? vid)
            }
        }

        // Filter out v0 revisions (auto-created initial revisions with no useful data)
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
    transformRow: (apiRow): RegistryRevisionRow => {
        const variantId = apiRow.workflow_variant_id ?? apiRow.variant_id ?? ""
        const variantName = _variantNameCache?.map.get(variantId) ?? apiRow.name ?? variantId ?? "-"

        return {
            key: apiRow.id,
            revisionId: apiRow.id,
            workflowId: apiRow.workflow_id ?? "",
            variantId,
            variantName,
            version: apiRow.version ?? null,
            model: pickModelFromParams(apiRow.data?.parameters ?? null),
            createdAt: apiRow.created_at ?? null,
        }
    },
    isEnabled: (meta) => Boolean(meta?.projectId) && Boolean(meta?.workflowId),
    listCountsConfig: {
        totalCountMode: "unknown",
    },
})
