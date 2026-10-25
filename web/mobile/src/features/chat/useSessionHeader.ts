import {querySessionStreams, type SessionStream} from "@agenta/entities/session"
import {useQuery, type Query, type QueryClient} from "@tanstack/react-query"

/** How often an open chat re-reads its row (and with it the reader's sharing state). */
export const SESSION_HEADER_RECHECK_MS = 60_000

export const sessionHeaderKey = (projectId: string, sessionId: string) =>
    ["session-stream", projectId, sessionId] as const

type HeaderQuery = Pick<Query<SessionStream | null>, "state">

/** When the row was last read, answered or failed (0 = never). */
const lastRead = (query: HeaderQuery): number =>
    Math.max(query.state.dataUpdatedAt, query.state.errorUpdatedAt)

/** One recheck budget: a read, answered or failed, holds for the recheck interval. Focus and
 * remount re-read only once it has run out, also when no read ever answered. */
const staleFromLastRead = (query: HeaderQuery): number =>
    lastRead(query) + SESSION_HEADER_RECHECK_MS - query.state.dataUpdatedAt
const budgetSpent = (query: HeaderQuery): boolean =>
    Date.now() - lastRead(query) >= SESSION_HEADER_RECHECK_MS

/**
 * The session's stream row: its name for the title, its `references` for the owning agent, and
 * the reader's sharing state (`sharing`: role, whether they can send, why it cannot be shared).
 * The chat screen reads its sharing state here, so opening a chat makes no sharing request. It
 * re-reads once per 60 s budget (the poll, or focus once the budget ran out), so a revoked grant
 * reaches the chat within that bound. Renames and turn invalidations re-read it at once.
 */
export const useSessionHeader = (projectId: string, sessionId: string) =>
    useQuery<SessionStream | null>({
        // Leads with `session-stream`: renames and turn invalidations match by that prefix.
        queryKey: sessionHeaderKey(projectId, sessionId),
        // POST, since the singular GET redirects onto the web app. A failed read throws: cached as
        // `null` it read as "this session has no agent", and the page went read-only.
        queryFn: async () => {
            const streams = await querySessionStreams({sessionId, projectId})
            if (!streams) throw new Error("Session header read failed")
            return streams[0] ?? null
        },
        enabled: Boolean(projectId && sessionId),
        staleTime: staleFromLastRead,
        // Only the open chat subscribes, so only it polls; the poll restarts at every read.
        refetchInterval: SESSION_HEADER_RECHECK_MS,
        refetchOnWindowFocus: budgetSpent,
        refetchOnReconnect: budgetSpent,
        retry: 1,
    })

/**
 * Re-read an open chat's row now, inside the same 60 s budget as its poll: a reconnect loop of
 * the watch stream must not turn into one read per attempt.
 */
export const recheckSessionHeader = async ({
    queryClient,
    projectId,
    sessionId,
    now = Date.now(),
}: {
    queryClient: QueryClient
    projectId: string
    sessionId: string
    now?: number
}) => {
    const key = sessionHeaderKey(projectId, sessionId)
    const state = queryClient.getQueryState(key)
    const last = Math.max(state?.dataUpdatedAt ?? 0, state?.errorUpdatedAt ?? 0)
    if (last && now - last < SESSION_HEADER_RECHECK_MS) return
    await queryClient.refetchQueries({queryKey: key, exact: true})
}
