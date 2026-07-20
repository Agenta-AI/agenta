import type {QueryClient} from "@tanstack/react-query"

// Scope by sessionId (key is ["session-inspector", kind, projectId, sessionId]): a bare prefix
// would refetch every open session's inspector tabs, not just this one's.
export const invalidateSessionInspector = (queryClient: QueryClient, sessionId: string) =>
    queryClient.invalidateQueries({
        predicate: (q) => q.queryKey[0] === "session-inspector" && q.queryKey[3] === sessionId,
    })
