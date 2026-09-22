import {querySessionStreams, type SessionStream} from "@agenta/entities/session"
import {useQuery} from "@tanstack/react-query"

/**
 * Key leads with `session-stream`: a rename patches by key PREFIX, so a nested key never matches
 * and the title lags; `invalidateSessionListQueries` matches the same token after a turn.
 */
export const sessionHeaderQueryKey = (projectId: string, sessionId: string) =>
    ["session-stream", projectId, sessionId] as const

/**
 * The session's stream row — its name for the title, its `references` for the agent that owns
 * it. One query for both readers (the tab bar and `useAgentEntity`), and the FIRST request the
 * chat screen makes: it carries what the workspace needs to scope itself, and it is a single-row
 * read. The singular GET redirects onto the web app, so this POSTs.
 */
export const useSessionHeader = (projectId: string, sessionId: string) =>
    useQuery<SessionStream | null>({
        queryKey: sessionHeaderQueryKey(projectId, sessionId),
        queryFn: async () => (await querySessionStreams({sessionId, projectId}))?.[0] ?? null,
        enabled: Boolean(projectId && sessionId),
        staleTime: 30_000,
    })
