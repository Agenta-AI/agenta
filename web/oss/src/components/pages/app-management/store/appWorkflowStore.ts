/**
 * App Workflow Paginated Store
 *
 * Provides paginated fetching for app workflows (non-evaluator) with IVT integration.
 * Uses queryWorkflows with `is_evaluator: false` flag to exclude evaluator workflows.
 */

import {createPaginatedEntityStore} from "@agenta/entities/shared"
import type {InfiniteTableFetchResult} from "@agenta/entities/shared"
import {queryWorkflows} from "@agenta/entities/workflow"
import type {Workflow} from "@agenta/entities/workflow"
import {projectIdAtom} from "@agenta/shared/state"
import {atom} from "jotai"
import {atomWithQuery} from "jotai-tanstack-query"

import {appWorkflowSearchTermAtom} from "./appWorkflowFilterAtoms"

// ============================================================================
// TABLE ROW TYPE
// ============================================================================

export interface AppWorkflowRow {
    key: string
    __isSkeleton?: boolean
    workflowId: string
    name: string
    appType: string
    updatedAt: string | null
    createdAt: string | null
    [k: string]: unknown
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Derive app type label from workflow flags.
 */
const deriveAppType = (flags: Workflow["flags"]): string => {
    if (flags?.is_custom) return "custom"
    if (flags?.is_chat) return "chat"
    return "completion"
}

// ============================================================================
// META ATOM
// ============================================================================

interface AppWorkflowQueryMeta {
    projectId: string | null
    searchTerm?: string
}

const appWorkflowMetaAtom = atom<AppWorkflowQueryMeta>((get) => ({
    projectId: get(projectIdAtom),
    searchTerm: get(appWorkflowSearchTermAtom) || undefined,
}))

// ============================================================================
// PAGINATED STORE
// ============================================================================

const skeletonDefaults: Partial<AppWorkflowRow> = {
    workflowId: "",
    name: "",
    appType: "",
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

        const response = await queryWorkflows({
            projectId: meta.projectId,
            flags: {is_evaluator: false},
            windowing: {limit, order: "descending", next: cursor ?? undefined},
        })

        // Client-side search filtering
        let workflows = response.workflows
        if (meta.searchTerm) {
            const term = meta.searchTerm.toLowerCase()
            workflows = workflows.filter(
                (w) => w.name?.toLowerCase().includes(term) || w.slug?.toLowerCase().includes(term),
            )
        }

        return {
            rows: workflows,
            totalCount: null,
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
        appType: deriveAppType(apiRow.flags),
        updatedAt: apiRow.updated_at ?? apiRow.created_at ?? null,
        createdAt: apiRow.created_at ?? null,
    }),
    isEnabled: (meta) => Boolean(meta?.projectId),
    listCountsConfig: {
        totalCountMode: "unknown",
    },
})

// ============================================================================
// COUNT ATOM
// ============================================================================

/**
 * Lightweight query atom that fetches all app workflows just for the count.
 * Discards workflow data to avoid duplicating state with the paginated store.
 * Temporary until the backend provides an optimized count endpoint.
 */
const appWorkflowCountQueryAtom = atomWithQuery((get) => {
    const projectId = get(projectIdAtom)

    return {
        queryKey: ["appWorkflowCount", projectId],
        queryFn: async () => {
            if (!projectId) return 0
            const response = await queryWorkflows({
                projectId,
                flags: {is_evaluator: false},
            })
            return response.count ?? response.workflows.length
        },
        enabled: !!projectId,
        staleTime: 30_000,
        refetchOnWindowFocus: false,
    }
})

/**
 * Derived atom exposing just the count number (0 while loading).
 */
export const appWorkflowCountAtom = atom((get) => {
    const query = get(appWorkflowCountQueryAtom)
    return query.data ?? 0
})
