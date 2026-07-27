import {useEffect, useMemo, useState} from "react"

import {clearLastContext} from "@/lib/context"

import {classifyPageFailure} from "./pageFailure"
import {SessionRow} from "./SessionRow"
import {SessionSearchBar} from "./SessionSearchBar"
import {SessionListEmpty, SessionListError, SessionListLoading} from "./states/SessionListStates"
import {livenessBySession, useLivenessPoll} from "./useLivenessPoll"
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
    const liveness = useLivenessPoll(projectId)
    const liveBadges = useMemo(() => livenessBySession(liveness.data), [liveness.data])
    const pages = query.data?.pages ?? []
    const {failed, laterPageFailed} = classifyPageFailure(pages, query.isError)

    // A stored pair pointing at a deleted project would forward `/m/` straight back here
    // on every launch. Drop it as soon as its project will not load; `ContextSync`
    // restores the fast path from the next project that does, so a transient failure
    // costs one visit to the picker.
    useEffect(() => {
        if (failed) clearLastContext()
    }, [failed])
    const rows = pages.flatMap((page) => page ?? []).filter((session) => !session.archived_at)

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
                        liveness={liveBadges ? (liveBadges.get(session.session_id) ?? null) : undefined}
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
        <div className="bg-background text-foreground flex min-h-dvh flex-col">
            <div className="border-border border-b p-4">
                <SessionSearchBar value={input} onChange={setInput} />
            </div>
            {body}
        </div>
    )
}
