import {useEffect, useMemo, useState} from "react"

import {FilterChip} from "@/components/FilterChip"
import {ScreenScaffold} from "@/components/ScreenScaffold"
import {clearLastContext} from "@/lib/context"

import {ProjectSwitcher} from "../context/ProjectSwitcher"

import {mergeSessionRows} from "./mergeSessionRows"
import {classifyPageFailure} from "./pageFailure"
import {filterPendingRows} from "./pendingFilter"
import {SessionRow} from "./SessionRow"
import {SessionSearchBar} from "./SessionSearchBar"
import {
    SessionListEmpty,
    SessionListError,
    SessionListLoading,
    SessionListPendingEmpty,
} from "./states/SessionListStates"
import {pendingCountBySession, useActionableInteractions} from "./useActionableInteractions"
import {livenessBySession, useLivenessPoll} from "./useLivenessPoll"
import {useSessionListHead} from "./useSessionListHead"
import {useSessionListScrollRestore} from "./useSessionListScrollRestore"
import {useSessionsInfinite} from "./useSessionsInfinite"

/** Sessions list: server-side search, id+activity cursor paging, archived rows hidden. */
export const SessionListScreen = ({
    workspaceId,
    projectId,
}: {
    workspaceId: string
    projectId: string
}) => {
    const [onlyPending, setOnlyPending] = useState(false)
    const [input, setInput] = useState("")
    const [search, setSearch] = useState("")
    useEffect(() => {
        const handle = setTimeout(() => setSearch(input.trim()), 300)
        return () => clearTimeout(handle)
    }, [input])

    const query = useSessionsInfinite(projectId, search)
    // Bounded liveness for the list itself: newest page only, so a session created elsewhere
    // shows up without a manual refresh (see useSessionListHead).
    const head = useSessionListHead(projectId, search)
    const scroll = useSessionListScrollRestore(projectId, !query.isPending)
    const liveness = useLivenessPoll(projectId)
    const liveBadges = useMemo(() => livenessBySession(liveness.data), [liveness.data])
    const interactions = useActionableInteractions(projectId)
    const pendingBySession = useMemo(
        () => pendingCountBySession(interactions.data),
        [interactions.data],
    )
    // Sessions, not interactions: the filter shows rows, and one session can hold several gates.
    const waitingSessions = pendingBySession?.size ?? 0
    const pages = query.data?.pages ?? []
    const {failed, laterPageFailed} = classifyPageFailure(pages, query.isError)

    // A stored pair pointing at a deleted project would forward `/m/` straight back here
    // on every launch. Drop it as soon as its project will not load; `ContextSync`
    // restores the fast path from the next project that does, so a transient failure
    // costs one visit to the picker.
    useEffect(() => {
        if (failed) clearLastContext()
    }, [failed])
    const merged = useMemo(
        () =>
            mergeSessionRows(
                head.data ?? [],
                (query.data?.pages ?? []).flatMap((page) => page ?? []),
            ),
        [head.data, query.data],
    )
    const pending = useMemo(
        () => filterPendingRows(merged, pendingBySession, Boolean(search)),
        [merged, pendingBySession, search],
    )
    const rows = onlyPending ? pending.rows : merged

    // Answering the last gate must not strand the user on an empty filtered list.
    useEffect(() => {
        if (onlyPending && waitingSessions === 0) setOnlyPending(false)
    }, [onlyPending, waitingSessions])

    let body
    if (query.isPending) {
        body = <SessionListLoading />
    } else if (failed) {
        body = <SessionListError onRetry={() => void query.refetch()} />
    } else if (rows.length === 0) {
        // Filtered-empty is not the same as project-empty: the waiting sessions are real, just
        // deeper than the pages fetched so far.
        body = onlyPending ? (
            <SessionListPendingEmpty
                unloaded={pending.unloaded}
                searching={Boolean(search)}
                canLoadMore={Boolean(query.hasNextPage)}
                loading={query.isFetchingNextPage}
                onLoadMore={() => void query.fetchNextPage()}
            />
        ) : (
            <SessionListEmpty />
        )
    } else {
        body = (
            <div className="flex flex-col">
                {onlyPending && pending.unloaded > 0 ? (
                    <p className="text-muted-foreground border-border border-b px-4 py-2 text-xs">
                        {pending.unloaded} more further down the list, not loaded yet.
                    </p>
                ) : null}
                {rows.map((session) => (
                    <SessionRow
                        key={session.id}
                        session={session}
                        href={`/w/${workspaceId}/p/${projectId}/sessions/${session.session_id}`}
                        liveness={
                            liveBadges ? (liveBadges.get(session.session_id) ?? null) : undefined
                        }
                        pendingApprovals={pendingBySession?.get(session.session_id) ?? 0}
                    />
                ))}
                {laterPageFailed || query.hasNextPage ? (
                    <button
                        type="button"
                        className="text-muted-foreground p-4 text-center text-xs"
                        disabled={query.isFetchingNextPage}
                        onClick={() => void query.fetchNextPage()}
                    >
                        {query.isFetchingNextPage
                            ? "Loading…"
                            : laterPageFailed
                              ? "Could not load more sessions. Tap to retry."
                              : "Load more"}
                    </button>
                ) : null}
            </div>
        )
    }

    return (
        <ScreenScaffold
            scrollRef={scroll.ref}
            onScroll={scroll.onScroll}
            header={
                <div className="border-border flex shrink-0 flex-col gap-2 border-b px-4 pt-2 pb-3">
                    <ProjectSwitcher workspaceId={workspaceId} projectId={projectId} />
                    {/* Search and filter share a row: both narrow the same list, and three
                        stacked full-width rows cost most of a phone's first screen. */}
                    <div className="flex items-center gap-2">
                        <SessionSearchBar value={input} onChange={setInput} />
                        {waitingSessions > 0 ? (
                            <FilterChip
                                active={onlyPending}
                                onToggle={() => setOnlyPending((on) => !on)}
                                label={
                                    onlyPending
                                        ? "Show all sessions"
                                        : `Show only the ${waitingSessions} session${waitingSessions === 1 ? "" : "s"} waiting on you`
                                }
                            >
                                {waitingSessions} waiting
                            </FilterChip>
                        ) : null}
                    </div>
                </div>
            }
        >
            {body}
        </ScreenScaffold>
    )
}
