import {useCallback, useMemo} from "react"

import {type SessionExpansion, type SessionStream} from "@agenta/entities/session"
import {projectIdAtom} from "@agenta/shared/state"
import {useAtomValue, useSetAtom} from "jotai"

import {sessionRowVm, type SessionRowVm} from "../row/viewModel"

import {
    resetSessionFiltersAtom,
    sessionAgentFilterAtom,
    sessionFiltersActiveAtom,
    sessionFiltersActiveExceptAgentAtom,
    sessionSearchAtom,
    sessionShowArchivedAtom,
    sessionShowTriggeredAtom,
    sessionStatusFilterAtom,
} from "./filters"
import {isSessionPinnedAtom, pinnedSessionIdsAtom, toggleSessionPinAtom} from "./pins"
import {selectedSessionListPolicy, type SessionListRequestPolicy} from "./sessionListPolicy"
import {
    pendingBySessionId,
    rowsFromPages,
    useActionableInteractions,
    useSessionList,
    type SessionListOptions,
} from "./useSessionList"

/**
 * A pin is an explicit user request and overrides the surface's origin filter — a pinned
 * automation session must still show in human (exclude-trigger) mode (P2-8). It also needs the
 * `trigger` expansion regardless of the surface's own policy: a human-mode surface never
 * requests it, so a pinned automation row's name would otherwise never resolve and fall back to
 * "Missing schedule".
 */
export function pinnedSessionListArgs(
    shared: SessionListOptions,
    pinnedIds: string[],
): SessionListOptions {
    return {
        ...shared,
        originPolicy: "all",
        expansions: Array.from(new Set<SessionExpansion>([...shared.expansions, "trigger"])),
        sessionIds: pinnedIds,
        enabled: pinnedIds.length > 0,
    }
}

export interface SessionGroup {
    key: "pinned" | "recent"
    /**
     * Present only when the group warrants a heading: pins always carry one, and the main list
     * gets a counterpart ONLY while a pinned group is showing — without one, the rows below the
     * pins read as more pinned rows that lost their heading.
     */
    label?: string
    rows: SessionRowVm[]
}

export interface UseSessionsListArgs {
    defaultPolicy: SessionListRequestPolicy
    automationPolicy: SessionListRequestPolicy
    /**
     * Route-supplied agent scope (`/apps/[app_id]/sessions`). Overrides the agent filter rather
     * than writing to it, so the project page's filter is never left holding a value the user
     * did not choose.
     */
    agentId?: string | null
}

/**
 * The organised session list: groups (pins first), one pager, every filter a server predicate.
 *
 * Pins render as their own group, fetched by id, and are excluded from the main list so nothing
 * appears twice; both queries are server-ordered, so there is only ever one ordering. Which group
 * a loaded row shows in is decided here from the pin set, so pinning moves the row on the same
 * frame rather than after both queries refetch under their new keys.
 *
 * The automations switch picks WHICH sessions, it doesn't add a second set: one list, one pager.
 * Mixing both in one recency-ordered feed meant a busy schedule buried your own sessions, and
 * grouping them client-side made paging back-fill a group above another.
 */
export const useSessionsList = ({
    agentId: scopedAgentId,
    defaultPolicy,
    automationPolicy,
}: UseSessionsListArgs) => {
    const projectId = useAtomValue(projectIdAtom) ?? ""
    const search = useAtomValue(sessionSearchAtom)
    const agentFilter = useAtomValue(sessionAgentFilterAtom)
    const agentId = scopedAgentId ?? agentFilter
    const status = useAtomValue(sessionStatusFilterAtom)
    const includeArchived = useAtomValue(sessionShowArchivedAtom)
    const showTriggered = useAtomValue(sessionShowTriggeredAtom)
    const projectFiltersActive = useAtomValue(sessionFiltersActiveAtom)
    const scopedFiltersActive = useAtomValue(sessionFiltersActiveExceptAgentAtom)
    const filtersActive = scopedAgentId ? scopedFiltersActive : projectFiltersActive
    const resetFilters = useSetAtom(resetSessionFiltersAtom)
    const pinnedIds = useAtomValue(pinnedSessionIdsAtom)

    const interactions = useActionableInteractions(projectId)
    const pendingBySession = useMemo(
        () => pendingBySessionId(interactions.data),
        [interactions.data],
    )
    const waitingIds = useMemo(
        () => (pendingBySession ? [...pendingBySession.keys()] : undefined),
        [pendingBySession],
    )

    const policy = selectedSessionListPolicy(showTriggered, defaultPolicy, automationPolicy)
    const shared = {
        originPolicy: policy.origin,
        expansions: policy.expansions,
        search,
        agentId,
        status,
        includeArchived,
        waitingSessionIds: waitingIds,
    }
    const pinnedQuery = useSessionList(pinnedSessionListArgs(shared, pinnedIds))
    const listQuery = useSessionList({
        ...shared,
        excludeSessionIds: pinnedIds,
    })

    const pinnedSet = useMemo(() => new Set(pinnedIds), [pinnedIds])
    // Memoized: `rowsFromPages` mints a new array per call, and an unstable array here would
    // re-derive every row VM (and re-render every memoized row) on every render.
    const listRows = useMemo(() => rowsFromPages(listQuery.data?.pages), [listQuery.data?.pages])
    const pinnedRowsAll = useMemo(
        () => rowsFromPages(pinnedQuery.data?.pages),
        [pinnedQuery.data?.pages],
    )
    const knownById = useMemo(() => {
        const byId = new Map<string, SessionStream>()
        for (const row of [...pinnedRowsAll, ...listRows]) byId.set(row.session_id, row)
        return byId
    }, [pinnedRowsAll, listRows])

    const groups = useMemo(() => {
        const vm = (row: SessionStream, pinned: boolean) =>
            sessionRowVm(row, {pinned, pending: pendingBySession?.get(row.session_id)})
        const pinnedRows = pinnedIds.flatMap((id) => {
            const row = knownById.get(id)
            return row ? [vm(row, true)] : []
        })
        const recentRows = listRows
            .filter((row) => !pinnedSet.has(row.session_id))
            .map((row) => vm(row, false))

        const result: SessionGroup[] = []
        if (pinnedRows.length > 0)
            result.push({key: "pinned", label: `Pinned ${pinnedRows.length}`, rows: pinnedRows})
        result.push({
            key: "recent",
            label:
                pinnedRows.length > 0 && recentRows.length > 0
                    ? showTriggered
                        ? "Automation runs"
                        : "Recent"
                    : undefined,
            rows: recentRows,
        })
        return result
    }, [pinnedIds, knownById, listRows, pinnedSet, pendingBySession, showTriggered])

    const refetchList = listQuery.refetch
    const refetchPinned = pinnedQuery.refetch
    const refetch = useCallback(() => {
        void refetchList()
        void refetchPinned()
    }, [refetchList, refetchPinned])

    return {
        groups,
        isEmpty: groups.every((group) => group.rows.length === 0),
        paging: {
            hasNext: Boolean(listQuery.hasNextPage),
            isLoadingNext: listQuery.isFetchingNextPage,
            loadNext: () => void listQuery.fetchNextPage(),
        },
        isPending: listQuery.isPending || (pinnedIds.length > 0 && pinnedQuery.isPending),
        isError: listQuery.isError || pinnedQuery.isError,
        refetch,
        /** Distinct sessions with an open gate — the rail's "Waiting" count. */
        waitingCount: pendingBySession?.size,
        filtersActive,
        resetFilters,
    }
}

/** The filter surface, as one hook — what the controls in `@agenta/sessions-ui` bind to. */
export const useSessionFilters = () => {
    const search = useAtomValue(sessionSearchAtom)
    const agentId = useAtomValue(sessionAgentFilterAtom)
    const status = useAtomValue(sessionStatusFilterAtom)
    const includeArchived = useAtomValue(sessionShowArchivedAtom)
    const mode = useAtomValue(sessionShowTriggeredAtom)
    const setSearch = useSetAtom(sessionSearchAtom)
    const setAgentId = useSetAtom(sessionAgentFilterAtom)
    const setStatus = useSetAtom(sessionStatusFilterAtom)
    const setIncludeArchived = useSetAtom(sessionShowArchivedAtom)
    const setMode = useSetAtom(sessionShowTriggeredAtom)
    const reset = useSetAtom(resetSessionFiltersAtom)
    return {
        search,
        agentId,
        status,
        includeArchived,
        /** True = the automations mode: the list shows trigger-started sessions INSTEAD. */
        mode,
        setSearch,
        setAgentId,
        setStatus,
        setIncludeArchived,
        setMode,
        reset,
    }
}

export const useSessionPins = () => {
    const ids = useAtomValue(pinnedSessionIdsAtom)
    const isPinned = useAtomValue(isSessionPinnedAtom)
    const toggle = useSetAtom(toggleSessionPinAtom)
    return {ids, isPinned, toggle}
}
