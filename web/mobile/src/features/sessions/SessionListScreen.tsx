import {useEffect, useMemo, useState} from "react"

import {ScreenScaffold} from "@/components/ScreenScaffold"
import {StatusTag} from "@/components/StatusTag"
import {clearLastContext} from "@/lib/context"

import {ProjectSwitcher} from "../context/ProjectSwitcher"

import {mergeSessionRows} from "./mergeSessionRows"
import {classifyPageFailure} from "./pageFailure"
import {SessionRow} from "./SessionRow"
import {SessionSearchBar} from "./SessionSearchBar"
import {SessionListEmpty, SessionListError, SessionListLoading} from "./states/SessionListStates"
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
    const pendingTotal = interactions.data?.length ?? 0
    const pages = query.data?.pages ?? []
    const {failed, laterPageFailed} = classifyPageFailure(pages, query.isError)

    // A stored pair pointing at a deleted project would forward `/m/` straight back here
    // on every launch. Drop it as soon as its project will not load; `ContextSync`
    // restores the fast path from the next project that does, so a transient failure
    // costs one visit to the picker.
    useEffect(() => {
        if (failed) clearLastContext()
    }, [failed])
    const rows = useMemo(
        () =>
            mergeSessionRows(
                head.data ?? [],
                (query.data?.pages ?? []).flatMap((page) => page ?? []),
            ),
        [head.data, query.data],
    )

    let body
    if (query.isPending) {
        body = <SessionListLoading />
    } else if (failed) {
        body = <SessionListError onRetry={() => void query.refetch()} />
    } else if (rows.length === 0) {
        body = <SessionListEmpty />
    } else {
        body = (
            <div className="flex flex-col">
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
                <div className="border-border flex shrink-0 flex-col gap-2 border-b p-4">
                    <ProjectSwitcher workspaceId={workspaceId} projectId={projectId} />
                    <SessionSearchBar value={input} onChange={setInput} />
                    {pendingTotal > 0 ? (
                        <p className="flex items-center gap-2">
                            <StatusTag tone="attention">{pendingTotal} pending</StatusTag>
                            <span className="text-muted-foreground text-xs">waiting on you</span>
                        </p>
                    ) : null}
                </div>
            }
        >
            {body}
        </ScreenScaffold>
    )
}
