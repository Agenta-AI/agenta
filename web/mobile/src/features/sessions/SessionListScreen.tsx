import {useEffect, useState} from "react"

import {SessionRow} from "./SessionRow"
import {SessionSearchBar} from "./SessionSearchBar"
import {SessionListEmpty, SessionListError, SessionListLoading} from "./states/SessionListStates"
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
    const pages = query.data?.pages ?? []
    // querySessions resolves null on failure — treat a null page like a query error.
    const failed = query.isError || pages.some((page) => page === null)
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
                    />
                ))}
                {query.hasNextPage ? (
                    <button
                        type="button"
                        className="text-muted-foreground p-4 text-center text-xs"
                        disabled={query.isFetchingNextPage}
                        onClick={() => void query.fetchNextPage()}
                    >
                        {query.isFetchingNextPage ? "Loading…" : "Load more"}
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
