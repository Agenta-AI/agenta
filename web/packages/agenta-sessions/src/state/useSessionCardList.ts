import {useCallback, useMemo, useState} from "react"

import {type SessionStream} from "@agenta/entities/session"
import {projectIdAtom} from "@agenta/shared/state"
import {useAtomValue} from "jotai"

import {sessionRowVm, type SessionRowVm} from "../row/viewModel"

import {pinnedSessionIdsAtom} from "./pins"
import type {SessionListRequestPolicy} from "./sessionListPolicy"
import {
    pendingBySessionId,
    rowsFromPages,
    useActionableInteractions,
    useSessionList,
} from "./useSessionList"

export interface SessionCardGroup {
    key: "waiting" | "pinned" | "recent"
    /** Absent when the heading is noise — a lone "Recent" over a plain list is one. */
    label?: string
    rows: SessionRowVm[]
}

export interface UseSessionCardListArgs {
    policy: SessionListRequestPolicy
    /** Scope to one agent's sessions — the app overview. Omit for the whole project. */
    agentId?: string
    /** Caps the CARD, not each group — pinning a visible row is a pure reorder, never growth. */
    limit?: number
    /** Pinned sessions lead the list, and are excluded from the recent rows below them. */
    withPinned?: boolean
}

/**
 * A capped session list for a card surface (Home, an agent's overview). Groups run
 * waiting → pinned → recent: waiting leads because a blocked session is the only row that costs
 * you something to miss; the rest is history you can browse at your own pace.
 *
 * The gate poll is project-wide, so its ids alone can't be trusted as this card's waiting set —
 * they go back to the server as a `session_ids` pushdown, which intersects them with the card's
 * own scope (agent, origin, archived). Membership and order stay the server's; which GROUP a
 * loaded row renders in is decided here, so pinning moves it without waiting on two refetches.
 * A waiting session that is also pinned renders once, in the group you must act on.
 *
 * "Show more" reveals in place, a page at a time — wanting three more rows is not the "View all"
 * errand, and the list's own query already holds the next page.
 */
export const useSessionCardList = ({
    policy,
    agentId,
    limit = 7,
    withPinned = false,
}: UseSessionCardListArgs) => {
    const [extraRows, setExtraRows] = useState(0)
    const projectId = useAtomValue(projectIdAtom) ?? ""
    const pinnedIds = useAtomValue(pinnedSessionIdsAtom)

    const interactions = useActionableInteractions(projectId)
    const pendingBySession = useMemo(
        () => pendingBySessionId(interactions.data),
        [interactions.data],
    )
    const waitingIds = useMemo(
        () => (pendingBySession ? [...pendingBySession.keys()] : []),
        [pendingBySession],
    )
    const useWaiting = waitingIds.length > 0

    const waitingQuery = useSessionList({
        originPolicy: policy.origin,
        expansions: policy.expansions,
        agentId,
        sessionIds: waitingIds,
        enabled: useWaiting,
    })
    const usePins = withPinned && pinnedIds.length > 0
    const pinnedQuery = useSessionList({
        originPolicy: policy.origin,
        expansions: policy.expansions,
        agentId,
        sessionIds: pinnedIds,
        enabled: usePins,
    })
    const listQuery = useSessionList({
        originPolicy: policy.origin,
        expansions: policy.expansions,
        agentId,
        excludeSessionIds: withPinned ? [...pinnedIds, ...waitingIds] : waitingIds,
    })

    const pinnedSet = useMemo(() => new Set(pinnedIds), [pinnedIds])
    // Memoized: `rowsFromPages` mints a new array per call, and an unstable array here would
    // re-derive every row VM (and re-render every memoized row) on every render.
    const listRows = useMemo(() => rowsFromPages(listQuery.data?.pages), [listQuery.data?.pages])
    const waitingRowsAll = useMemo(
        () => (useWaiting ? rowsFromPages(waitingQuery.data?.pages) : []),
        [useWaiting, waitingQuery.data?.pages],
    )
    const waitingSet = useMemo(
        () => new Set(waitingRowsAll.map((row) => row.session_id)),
        [waitingRowsAll],
    )
    const pinnedRowsAll = useMemo(
        () => (usePins ? rowsFromPages(pinnedQuery.data?.pages) : []),
        [usePins, pinnedQuery.data?.pages],
    )
    const knownById = useMemo(() => {
        const byId = new Map<string, SessionStream>()
        for (const row of [...pinnedRowsAll, ...listRows]) byId.set(row.session_id, row)
        return byId
    }, [pinnedRowsAll, listRows])

    const shownLimit = limit + extraRows
    const {groups, isEmpty, shownCount} = useMemo(() => {
        const waitingRows = waitingRowsAll.slice(0, shownLimit)
        const allPinned = usePins
            ? pinnedIds.flatMap((id) => {
                  const row = knownById.get(id)
                  return row && !waitingSet.has(id) ? [row] : []
              })
            : []
        const pinnedRows = allPinned.slice(0, Math.max(0, shownLimit - waitingRows.length))
        const recentRows = listRows
            // Only a card that RENDERS a pinned group may withhold pinned rows from here. Automation
            // runs doesn't, so filtering them out unconditionally made pinning one delete it from view.
            .filter(
                (row) =>
                    (!withPinned || !pinnedSet.has(row.session_id)) &&
                    !waitingSet.has(row.session_id),
            )
            .slice(0, Math.max(0, shownLimit - waitingRows.length - pinnedRows.length))

        const grouped = waitingRows.length > 0 || pinnedRows.length > 0
        const vm = (row: SessionStream) =>
            sessionRowVm(row, {
                pinned: pinnedSet.has(row.session_id),
                pending: pendingBySession?.get(row.session_id),
            })
        const result: SessionCardGroup[] = []
        if (waitingRows.length > 0)
            result.push({key: "waiting", label: "Waiting on you", rows: waitingRows.map(vm)})
        if (pinnedRows.length > 0)
            result.push({key: "pinned", label: "Pinned", rows: pinnedRows.map(vm)})
        result.push({
            key: "recent",
            label: grouped && recentRows.length > 0 ? "Recent" : undefined,
            rows: recentRows.map(vm),
        })
        return {
            groups: result,
            isEmpty: recentRows.length === 0 && pinnedRows.length === 0 && waitingRows.length === 0,
            shownCount: recentRows.length + pinnedRows.length + waitingRows.length,
        }
    }, [
        waitingRowsAll,
        shownLimit,
        usePins,
        pinnedIds,
        knownById,
        waitingSet,
        listRows,
        withPinned,
        pinnedSet,
        pendingBySession,
    ])

    const canShowMore = !isEmpty && (listRows.length > shownCount || Boolean(listQuery.hasNextPage))
    const {hasNextPage, isFetchingNextPage, fetchNextPage} = listQuery
    const showMore = useCallback(() => {
        setExtraRows((shown) => shown + limit)
        if (hasNextPage && !isFetchingNextPage) void fetchNextPage()
    }, [limit, hasNextPage, isFetchingNextPage, fetchNextPage])

    return {
        groups,
        isPending: listQuery.isPending,
        isEmpty,
        /** All gated rows in this card's scope — the header's "N waiting" badge. */
        waitingTotal: waitingRowsAll.length,
        canShowMore,
        showMore,
    }
}
