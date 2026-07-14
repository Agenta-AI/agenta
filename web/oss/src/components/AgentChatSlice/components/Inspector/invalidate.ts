import type {QueryClient} from "@tanstack/react-query"

/**
 * Refresh only ONE session's inspector queries.
 *
 * Session-inspector queries are keyed `["session-inspector", kind, projectId, sessionId]` (see
 * `StreamsTab`/`StatesTab`). A bare `["session-inspector"]` prefix invalidates every open session's
 * State/Stream tabs — and the Inspector can be mounted for several sessions at once (docked panel +
 * compare-column drawer) — so scope by `sessionId` to avoid refetching unrelated sessions.
 */
export const invalidateSessionInspector = (queryClient: QueryClient, sessionId: string) =>
    queryClient.invalidateQueries({
        predicate: (q) => q.queryKey[0] === "session-inspector" && q.queryKey[3] === sessionId,
    })
