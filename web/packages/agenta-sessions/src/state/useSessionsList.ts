import {useCallback, useEffect, useMemo} from "react"

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
    sessionArchivedOnlyAtom,
    sessionShowTriggeredAtom,
    sessionStatusFilterAtom,
} from "./filters"
import {isSessionPinnedAtom, pinnedSessionIdsAtom, toggleSessionPinAtom} from "./pins"
import {
    awaitingHiddenRows,
    selectedSessionListPolicy,
    sessionGroupRows,
    shouldLoadMoreForHiddenRows,
    type SessionListRequestPolicy,
} from "./sessionListPolicy"
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
        // For the same reason as the origin above: a pin outranks the surface's own narrowing.
        // Both of these would otherwise drop rows the reader explicitly asked to keep — the
        // activity window silently hides a pin older than it (and the mobile list defaults that
        // window to seven days), and the archive-only view empties the group of every live pin.
        // The pin set is already the exact id list, so neither narrows anything worth keeping.
        activityFloor: undefined,
        archivedOnly: false,
        // And archived pins are still pins. You cannot pin an archived session (the shared menu
        // drops the verb), but you can archive a pinned one — and with the surface's default
        // `includeArchived: false` the row then vanished from the group instead of staying put.
        includeArchived: true,
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
    /**
     * ISO lower bound on last activity — the "Last activity" facet.
     *
     * A hook argument rather than a shared atom, because the surfaces want different defaults for
     * it: an atom would have applied one surface's window to the other.
     */
    activityFloor?: string
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
    activityFloor,
    defaultPolicy,
    automationPolicy,
}: UseSessionsListArgs) => {
    const projectId = useAtomValue(projectIdAtom) ?? ""
    const search = useAtomValue(sessionSearchAtom)
    const agentFilter = useAtomValue(sessionAgentFilterAtom)
    const agentId = scopedAgentId ?? agentFilter
    const status = useAtomValue(sessionStatusFilterAtom)
    const includeArchived = useAtomValue(sessionShowArchivedAtom)
    const archivedOnly = useAtomValue(sessionArchivedOnlyAtom)
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
        archivedOnly,
        activityFloor,
        waitingSessionIds: waitingIds,
    }
    const pinnedQuery = useSessionList(pinnedSessionListArgs(shared, pinnedIds))
    // NOT `excludeSessionIds: pinnedIds`. The pin set is part of the query key, so pushing it down
    // re-keyed the main list on every pin — a refetch, and `keepPreviousData` marking the rows a
    // previous query's, which the view dims. Pinning one row visibly reloaded the whole page.
    //
    // Nothing is listed twice without it: `recentRows` below already drops pinned ids from this
    // query's rows, on the same frame as the toggle. The cost is that a page can render one row
    // short when it happens to contain a pinned one, which the top-up already handles.
    const listQuery = useSessionList(shared)

    const pinnedSet = useMemo(() => new Set(pinnedIds), [pinnedIds])
    // Memoized: `rowsFromPages` mints a new array per call, and an unstable array here would
    // re-derive every row VM (and re-render every memoized row) on every render.
    // Which rules each group applies (pins are exempt from all of them) is `sessionGroupRows`.
    const listRows = useMemo(
        () => sessionGroupRows("main", rowsFromPages(listQuery.data?.pages)),
        [listQuery.data?.pages],
    )
    const pinnedRowsAll = useMemo(
        () => sessionGroupRows("pinned", rowsFromPages(pinnedQuery.data?.pages)),
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

    // A whole page can be unstarted rows (they are the newest); pull the next one instead of
    // showing "No sessions yet" over a list that has plenty one page down.
    const {hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage} = listQuery
    const topUpArgs = {
        visibleRows: listRows.length,
        hasNextPage: Boolean(hasNextPage),
        isError: isFetchNextPageError,
    }
    // Held across the in-flight request too, or the list would flash empty mid-top-up.
    const awaitingTopUp = awaitingHiddenRows(topUpArgs)
    const shouldTopUp = shouldLoadMoreForHiddenRows({...topUpArgs, isFetchingNextPage})
    useEffect(() => {
        if (shouldTopUp) void fetchNextPage()
    }, [shouldTopUp, fetchNextPage])

    const refetchList = listQuery.refetch
    const refetchPinned = pinnedQuery.refetch
    const refetch = useCallback(() => {
        void refetchList()
        void refetchPinned()
    }, [refetchList, refetchPinned])

    return {
        groups,
        // Not "empty" while a top-up is on its way — that would flash the empty state over a
        // list whose first page happened to be all unstarted rows.
        isEmpty: !awaitingTopUp && groups.every((group) => group.rows.length === 0),
        paging: {
            hasNext: Boolean(hasNextPage),
            isLoadingNext: isFetchingNextPage,
            loadNext: () => void fetchNextPage(),
        },
        // The MAIN list only. The pinned query's first fetch starts the moment you pin your first
        // session, and folding it in here threw the whole table back to its skeleton at exactly
        // that moment. The pins group arrives a beat later instead, above rows that never left.
        isPending: listQuery.isPending,
        /**
         * These rows answer a PREVIOUS query, not the current one.
         *
         * `placeholderData: keepPreviousData` keeps the old rows on screen while a new key
         * resolves, which is right for a pin toggle (same rows, membership rechecked) and wrong
         * for a search (the rows genuinely do not match what was typed). Without this flag the
         * view cannot tell the two apart, so it presented one query's results as the answer to
         * another, and rendered "No sessions yet" over a list that had simply not settled.
         */
        // The MAIN list only, for the same reason as `isPending`. The pinned query re-keys on
        // every pin (its ids ARE its key), and dimming the whole table because a two-row group is
        // resolving is the reload this flag exists to avoid.
        isPlaceholder: listQuery.isPlaceholderData,
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
    const archivedOnly = useAtomValue(sessionArchivedOnlyAtom)
    const mode = useAtomValue(sessionShowTriggeredAtom)
    const setSearch = useSetAtom(sessionSearchAtom)
    const setAgentId = useSetAtom(sessionAgentFilterAtom)
    const setStatus = useSetAtom(sessionStatusFilterAtom)
    const setIncludeArchived = useSetAtom(sessionShowArchivedAtom)
    const setArchivedOnly = useSetAtom(sessionArchivedOnlyAtom)
    const setMode = useSetAtom(sessionShowTriggeredAtom)
    const reset = useSetAtom(resetSessionFiltersAtom)
    return {
        search,
        agentId,
        status,
        includeArchived,
        archivedOnly,
        /** True = the automations mode: the list shows trigger-started sessions INSTEAD. */
        mode,
        setSearch,
        setAgentId,
        setStatus,
        setIncludeArchived,
        setArchivedOnly,
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
