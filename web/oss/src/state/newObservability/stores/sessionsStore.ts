import type {PrimitiveAtom} from "jotai"
import {atom} from "jotai"
import {atomFamily} from "jotai/utils"
import {atomWithStorage} from "jotai/vanilla/utils"

import {createInfiniteDatasetStore} from "@/oss/components/InfiniteVirtualTable"
import type {WindowingState} from "@/oss/components/InfiniteVirtualTable/types"
import {SessionRow} from "@/oss/components/pages/observability/components/SessionsTable/assets/getSessionColumns"
import {fetchSessions} from "@/oss/services/tracing/api"
import {selectedAppIdAtom} from "@/oss/state/app/selectors/app"
import {projectIdAtom} from "@/oss/state/project"

// Types
export interface SessionsTableMeta {
    projectId: string | null
    appIds: string[]
    filters: any[] | null
    sort: {
        type: "standard" | "custom"
        sorted?: string
        customRange?: {
            startTime?: string
            endTime?: string
        }
    } | null
    _refreshTrigger?: number
}

interface SessionsTableMetaState {
    filters: any[] | null
    sort: {
        type: "standard" | "custom"
        sorted?: string
        customRange?: {
            startTime?: string
            endTime?: string
        }
    } | null
    version: number
}

// Initial State
const createInitialMetaState = (): SessionsTableMetaState => ({
    filters: null,
    sort: null,
    version: 0,
})

// Atoms
const sessionsMetaStateAtomFamily = atomFamily<
    string | null,
    PrimitiveAtom<SessionsTableMetaState>
>(
    (key: string | null) => {
        const initial = createInitialMetaState()
        if (!key || typeof window === "undefined") {
            return atom(initial)
        }
        return atomWithStorage<SessionsTableMetaState>(`sessions:filters:${key}`, initial)
    },
    (a, b) => a === b,
)

export const sessionsRefreshTriggerAtom = atom(0)

export const invalidateSessionsTableAtom = atom(null, (get, set) => {
    set(sessionsRefreshTriggerAtom, (prev) => prev + 1)
})

export const sessionsTableMetaAtom = atom<
    SessionsTableMeta,
    [SessionsTableMeta | ((prev: SessionsTableMeta) => SessionsTableMeta)],
    void
>(
    (get) => {
        const projectId = get(projectIdAtom)
        const appId = get(selectedAppIdAtom)
        const stateKey = projectId || "default"
        const state = get(sessionsMetaStateAtomFamily(stateKey))
        const refreshTrigger = get(sessionsRefreshTriggerAtom)

        const meta: SessionsTableMeta = {
            projectId: projectId ?? null,
            appIds: appId ? [appId as string] : [],
            filters: state.filters,
            sort: state.sort,
            _refreshTrigger: refreshTrigger,
        }

        return meta
    },
    (get, set, update) => {
        const projectId = get(projectIdAtom)
        const stateKey = projectId || "default"
        const stateAtom = sessionsMetaStateAtomFamily(
            stateKey,
        ) as PrimitiveAtom<SessionsTableMetaState>
        const state = get(stateAtom)
        const current = get(sessionsTableMetaAtom)
        const next = typeof update === "function" ? update(current) : update

        const filtersChanged = JSON.stringify(state.filters) !== JSON.stringify(next.filters)
        const sortChanged = JSON.stringify(state.sort) !== JSON.stringify(next.sort)

        if (filtersChanged || sortChanged) {
            set(stateAtom, {
                filters: next.filters,
                sort: next.sort,
                version: state.version + 1,
            })
        }
    },
)

/**
 * Creates a skeleton row for loading states
 */
export const createSessionSkeletonRow = ({
    offset,
    index,
    rowKey,
}: {
    offset: number
    index: number
    windowing: WindowingState | null
    rowKey: string
}): SessionRow => {
    return {
        session_id: `skeleton-${offset + index}`,
        isSkeleton: true,
        __isSkeleton: true,
    } as any
}

/**
 * Merges a skeleton row with fetched data
 */
const mergeRow = ({
    skeleton,
    apiRow,
}: {
    skeleton: SessionRow
    apiRow?: {session_ids: string[]; count: number} | string
    // ^ apiRow in this store is actually just a sessionID string because the fetchPage maps it down
    // wait, fetchPage below returns {rows: string[]} so apiRow is string.
}): SessionRow => {
    if (!apiRow || typeof apiRow !== "string") {
        return skeleton
    }
    return {
        session_id: apiRow,
        isSkeleton: false,
        __isSkeleton: false,
    } as any
}

// Dataset Store
const sessionsDatasetStoreInternal = createInfiniteDatasetStore<
    SessionRow,
    string, // API row type is just the session ID string
    SessionsTableMeta
>({
    key: "sessions-table",
    metaAtom: sessionsTableMetaAtom,
    createSkeletonRow: createSessionSkeletonRow,
    mergeRow,
    isEnabled: (meta) => Boolean(meta?.projectId),
    fetchPage: async ({limit, offset, cursor, meta, windowing}) => {
        if (!meta.projectId) {
            return {
                rows: [],
                totalCount: 0,
                hasMore: false,
                nextOffset: null,
                nextCursor: null,
                nextWindowing: null,
            }
        }

        // Construct windowing object for API
        // If we have a cursor from previous page, use it directly (it contains the full windowing)
        // Otherwise, construct from sort settings
        let apiWindowing: any

        if (cursor && typeof cursor === "object" && !Array.isArray(cursor)) {
            // cursor is the nextWindowing from previous page, use it as-is
            apiWindowing = {
                ...(cursor as Record<string, any>),
                limit, // Ensure limit is set
            }
        } else {
            // First page: construct windowing from sort settings
            apiWindowing = {
                limit,
            }

            if (meta.sort?.type === "standard" && meta.sort.sorted) {
                apiWindowing.oldest = meta.sort.sorted
            } else if (
                meta.sort?.type === "custom" &&
                (meta.sort.customRange?.startTime || meta.sort.customRange?.endTime)
            ) {
                const {startTime, endTime} = meta.sort.customRange || {}
                if (startTime) apiWindowing.oldest = startTime
                if (endTime) apiWindowing.newest = endTime
            }
        }

        const result = await fetchSessions({
            appId: meta.appIds[0], // Assuming single app selection for now
            windowing: apiWindowing,
            filter: meta.filters && meta.filters.length > 0 ? meta.filters : undefined,
        })

        const sessionIds = result.session_ids || []
        const totalCount = result.count || 0
        const nextWindowing = result.windowing || null

        return {
            rows: sessionIds,
            totalCount,
            // nextWindowing exists if there are more pages (backend returns it when limit is reached)
            hasMore: !!nextWindowing,
            nextOffset: offset + sessionIds.length,
            // Store the entire windowing object as the cursor for next page
            nextCursor: nextWindowing || null,
            nextWindowing: nextWindowing,
        }
    },
})

export const sessionsDatasetStore = sessionsDatasetStoreInternal
export const sessionsTableStore = sessionsDatasetStoreInternal.store

// Export specific atoms for consumers (like queries.ts) to avoid them needing to know scopeId/pageSize
export const sessionsRowsAtom = sessionsDatasetStoreInternal.atoms.rowsAtom({
    scopeId: "sessions",
    pageSize: 20,
})

export const sessionsTotalCountAtom = atom((get) => {
    const info = get(
        sessionsDatasetStoreInternal.atoms.paginationAtom({
            scopeId: "sessions",
            pageSize: 20,
        }),
    )
    return info.totalCount || 0
})
