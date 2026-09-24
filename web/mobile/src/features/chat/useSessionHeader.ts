import {querySessionStreams, type SessionStream} from "@agenta/entities/session"
import {useQuery} from "@tanstack/react-query"

/** The session's stream row: its name for the title, its `references` for the owning agent. */
export const useSessionHeader = (projectId: string, sessionId: string) =>
    useQuery<SessionStream | null>({
        // Leads with `session-stream`: renames and turn invalidations match by that prefix.
        queryKey: ["session-stream", projectId, sessionId],
        // POST, since the singular GET redirects onto the web app.
        queryFn: async () => (await querySessionStreams({sessionId, projectId}))?.[0] ?? null,
        enabled: Boolean(projectId && sessionId),
        staleTime: 30_000,
    })
