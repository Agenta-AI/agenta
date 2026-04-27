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
import {queryClient} from "@agenta/shared/api"
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
    deletedAt?: string | null
    deletedById?: string | null
    [k: string]: unknown
}

// ============================================================================
// META ATOM
// ============================================================================

export type AppWorkflowTableMode = "active" | "archived"

interface AppWorkflowQueryMeta {
    projectId: string | null
    searchTerm?: string
}

const APP_WORKFLOW_FLAGS = {is_evaluator: false} as const
const COUNT_QUERY_STALE_TIME = 30_000

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

const getCursorOffset = (cursor: string | null | undefined) =>
    cursor ? Number.parseInt(cursor, 10) || 0 : 0

const isArchivedWorkflow = (workflow: Workflow) => Boolean(workflow.deleted_at)

const compareDeletedAtDesc = (a: Workflow, b: Workflow) => {
    const aTime = a.deleted_at ? Date.parse(a.deleted_at) : 0
    const bTime = b.deleted_at ? Date.parse(b.deleted_at) : 0
    return bTime - aTime
}

async function fetchArchivedAppWorkflows(meta: AppWorkflowQueryMeta) {
    if (!meta.projectId) return [] as Workflow[]

    const response = await queryWorkflows({
        projectId: meta.projectId,
        name: meta.searchTerm,
        flags: APP_WORKFLOW_FLAGS,
        includeArchived: true,
    })

    return response.workflows.filter(isArchivedWorkflow).sort(compareDeletedAtDesc)
}

async function fetchActiveAppWorkflowCount(meta: AppWorkflowQueryMeta) {
    if (!meta.projectId) return 0

    const response = await queryWorkflows({
        projectId: meta.projectId,
        name: meta.searchTerm,
        flags: APP_WORKFLOW_FLAGS,
    })

    return response.count ?? response.workflows.length
}

const skeletonDefaults: Partial<AppWorkflowRow> = {
    workflowId: "",
    name: "",
    appType: "",
    updatedAt: null,
    createdAt: null,
    deletedAt: null,
    deletedById: null,
    key: "",
}

const transformWorkflowRow = (apiRow: Workflow): AppWorkflowRow => ({
    key: apiRow.id,
    workflowId: apiRow.id,
    name: apiRow.name ?? apiRow.slug ?? apiRow.id,
    appType: "",
    updatedAt: apiRow.updated_at ?? apiRow.created_at ?? null,
    createdAt: apiRow.created_at ?? null,
    deletedAt: apiRow.deleted_at ?? null,
    deletedById: apiRow.deleted_by_id ?? null,
})

const createAppWorkflowMetaAtom = (searchTermAtom: typeof appWorkflowSearchTermAtom) =>
    atom<AppWorkflowQueryMeta>((get) => ({
        projectId: get(projectIdAtom),
        searchTerm: get(searchTermAtom).trim() || undefined,
    }))

const appWorkflowMetaAtom = createAppWorkflowMetaAtom(appWorkflowSearchTermAtom)

export const appWorkflowPaginatedStore = createPaginatedEntityStore<
    AppWorkflowRow,
    Workflow,
    AppWorkflowQueryMeta
>({
    entityName: "appWorkflow",
    metaAtom: appWorkflowMetaAtom,
    fetchPage: async ({meta, limit, cursor}): Promise<InfiniteTableFetchResult<Workflow>> => {
        if (!meta.projectId) {
            return emptyFetchResult<Workflow>()
        }

        const response = await queryWorkflows({
            projectId: meta.projectId,
            name: meta.searchTerm,
            flags: APP_WORKFLOW_FLAGS,
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
    transformRow: transformWorkflowRow,
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
const appWorkflowTotalCountQueryAtom = atomWithQuery((get) => {
    const projectId = get(projectIdAtom)

    return {
        queryKey: ["appWorkflowTotalCount", projectId],
        queryFn: async () => {
            return fetchActiveAppWorkflowCount({projectId})
        },
        enabled: !!projectId,
        staleTime: COUNT_QUERY_STALE_TIME,
        refetchOnWindowFocus: false,
    }
})

/**
 * Derived atom exposing the unfiltered total app count (0 while loading).
 */
export const appWorkflowTotalCountAtom = atom((get) => {
    const query = get(appWorkflowTotalCountQueryAtom)
    return query.data ?? 0
})

const appWorkflowCountQueryAtom = atomWithQuery((get) => {
    const projectId = get(projectIdAtom)
    const searchTerm = get(appWorkflowSearchTermAtom).trim() || undefined

    return {
        queryKey: ["appWorkflowCount", projectId, searchTerm ?? null],
        queryFn: async () => {
            return fetchActiveAppWorkflowCount({projectId, searchTerm})
        },
        enabled: !!projectId,
        staleTime: COUNT_QUERY_STALE_TIME,
        refetchOnWindowFocus: false,
    }
})

/**
 * Derived atom exposing the search-filtered app count (0 while loading).
 */
export const appWorkflowCountAtom = atom((get) => {
    const query = get(appWorkflowCountQueryAtom)
    return query.data ?? 0
})

const archivedAppWorkflowSearchTermAtom = atom("")

const archivedAppWorkflowMetaAtom = createAppWorkflowMetaAtom(archivedAppWorkflowSearchTermAtom)

const archivedAppWorkflowPaginatedStore = createPaginatedEntityStore<
    AppWorkflowRow,
    Workflow,
    AppWorkflowQueryMeta
>({
    entityName: "archivedAppWorkflow",
    metaAtom: archivedAppWorkflowMetaAtom,
    fetchPage: async ({meta, limit, cursor}): Promise<InfiniteTableFetchResult<Workflow>> => {
        if (!meta.projectId) {
            return emptyFetchResult<Workflow>()
        }

        const archivedWorkflows = await fetchArchivedAppWorkflows(meta)
        const offset = getCursorOffset(cursor)
        const rows = archivedWorkflows.slice(offset, offset + limit)
        const nextOffset = offset + rows.length

        return {
            rows,
            totalCount: archivedWorkflows.length,
            hasMore: nextOffset < archivedWorkflows.length,
            nextCursor: nextOffset < archivedWorkflows.length ? String(nextOffset) : null,
            nextOffset: null,
            nextWindowing: null,
        }
    },
    rowConfig: {
        getRowId: (row) => row.id,
        skeletonDefaults,
    },
    transformRow: transformWorkflowRow,
    isEnabled: (meta) => Boolean(meta?.projectId),
    listCountsConfig: {
        totalCountMode: "unknown",
    },
})

const archivedAppWorkflowTotalCountQueryAtom = atomWithQuery((get) => {
    const projectId = get(projectIdAtom)

    return {
        queryKey: ["archivedAppWorkflowTotalCount", projectId],
        queryFn: async () => {
            if (!projectId) return 0
            return (await fetchArchivedAppWorkflows({projectId})).length
        },
        enabled: !!projectId,
        staleTime: COUNT_QUERY_STALE_TIME,
        refetchOnWindowFocus: false,
    }
})

const archivedAppWorkflowTotalCountAtom = atom((get) => {
    const query = get(archivedAppWorkflowTotalCountQueryAtom)
    return query.data ?? 0
})

const archivedAppWorkflowCountQueryAtom = atomWithQuery((get) => {
    const projectId = get(projectIdAtom)
    const searchTerm = get(archivedAppWorkflowSearchTermAtom).trim() || undefined

    return {
        queryKey: ["archivedAppWorkflowCount", projectId, searchTerm ?? null],
        queryFn: async () => {
            if (!projectId) return 0
            return (await fetchArchivedAppWorkflows({projectId, searchTerm})).length
        },
        enabled: !!projectId,
        staleTime: COUNT_QUERY_STALE_TIME,
        refetchOnWindowFocus: false,
    }
})

const archivedAppWorkflowCountAtom = atom((get) => {
    const query = get(archivedAppWorkflowCountQueryAtom)
    return query.data ?? 0
})

export function getAppWorkflowTableState(mode: AppWorkflowTableMode = "active") {
    if (mode === "archived") {
        return {
            mode,
            searchTermAtom: archivedAppWorkflowSearchTermAtom,
            paginatedStore: archivedAppWorkflowPaginatedStore,
            countAtom: archivedAppWorkflowCountAtom,
            totalCountAtom: archivedAppWorkflowTotalCountAtom,
        }
    }

    return {
        mode,
        searchTermAtom: appWorkflowSearchTermAtom,
        paginatedStore: appWorkflowPaginatedStore,
        countAtom: appWorkflowCountAtom,
        totalCountAtom: appWorkflowTotalCountAtom,
    }
}

/**
 * Refreshes all app-management-specific app caches:
 * - paginated applications table
 * - unfiltered applications count
 * - search-filtered applications count
 */
export async function invalidateAppManagementWorkflowQueries() {
    appWorkflowPaginatedStore.invalidate()
    archivedAppWorkflowPaginatedStore.invalidate()

    await Promise.all([
        queryClient.invalidateQueries({queryKey: ["appWorkflowTotalCount"], exact: false}),
        queryClient.invalidateQueries({queryKey: ["appWorkflowCount"], exact: false}),
        queryClient.invalidateQueries({
            queryKey: ["archivedAppWorkflowTotalCount"],
            exact: false,
        }),
        queryClient.invalidateQueries({queryKey: ["archivedAppWorkflowCount"], exact: false}),
    ])
}

export {appWorkflowSearchTermAtom}
