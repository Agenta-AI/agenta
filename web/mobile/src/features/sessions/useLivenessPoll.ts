import {querySessionStreams, type SessionStream} from "@agenta/entities/session"
import {useQuery} from "@tanstack/react-query"

/** Shared key so other polls (interactions) can read the alive set from the cache. */
export const livenessQueryKey = (projectId: string) =>
    ["mobile", "session-liveness", projectId] as const

/**
 * Backend liveness for the project's sessions — mirrors the desktop pattern
 * (oss AgentChatSlice state/liveness.ts): ONE project-scoped `is_alive=true` query backs every
 * badge, low-priority, 15s while anything is alive, stops when idle, re-checks on focus.
 */
export const useLivenessPoll = (projectId: string) =>
    useQuery<SessionStream[] | null>({
        queryKey: livenessQueryKey(projectId),
        queryFn: ({signal}) =>
            querySessionStreams({projectId, isAlive: true, abortSignal: signal, lowPriority: true}),
        enabled: Boolean(projectId),
        staleTime: 10_000,
        refetchInterval: (query) => ((query.state.data?.length ?? 0) > 0 ? 15_000 : false),
        refetchOnWindowFocus: true,
    })

/** Coarse badge state for one session, derived from the shared poll. */
export type SessionLivenessBadge = "running" | "alive"

/** `session_id → badge` off the poll result; `undefined` while the poll hasn't resolved. */
export const livenessBySession = (
    streams: SessionStream[] | null | undefined,
): Map<string, SessionLivenessBadge> | undefined => {
    if (streams === undefined || streams === null) return undefined
    const map = new Map<string, SessionLivenessBadge>()
    for (const stream of streams) {
        map.set(stream.session_id, stream.flags?.is_running ? "running" : "alive")
    }
    return map
}
