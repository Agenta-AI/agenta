import {
    deriveStreamNest,
    livenessPollInterval,
    querySessionStreams,
    type SessionStream,
} from "@agenta/entities/session"
import {useQuery} from "@tanstack/react-query"

/** Shared key so other polls (interactions) can read the alive set from the cache. */
export const livenessQueryKey = (projectId: string) =>
    ["mobile", "session-liveness", projectId] as const

/**
 * Backend liveness for the project's sessions — mirrors the desktop pattern
 * (oss AgentChatSlice state/liveness.ts): ONE project-scoped `is_alive=true` query backs every
 * badge, low-priority, 15s while anything is RUNNING and 60s while one is merely alive, stops
 * when nothing is alive, re-checks on focus.
 */
export const useLivenessPoll = (projectId: string) =>
    useQuery<SessionStream[] | null>({
        queryKey: livenessQueryKey(projectId),
        queryFn: ({signal}) =>
            querySessionStreams({projectId, isAlive: true, abortSignal: signal, lowPriority: true}),
        enabled: Boolean(projectId),
        staleTime: 10_000,
        refetchInterval: (query) => livenessPollInterval(query.state.data),
        refetchOnWindowFocus: true,
    })

/** Coarse badge state for one session, derived from the shared poll. */
export type SessionLivenessBadge = "running" | "alive"

/**
 * `session_id → badge` off the poll result; `undefined` while the poll hasn't resolved.
 *
 * Derived through the shared `deriveStreamNest`, never off `flags.is_running` directly, so this
 * badge and the desktop tab dot (`oss AgentChatSlice state/liveness.ts`
 * `sessionDotStatusAtomFamily`) split the same three flags the same way: running wins, then alive,
 * and a proc-dead row the filter still returned (a zombie whose flags no longer say alive) is
 * omitted — it reads as idle rather than being badged live. `deriveSessionLifecycle` is the same
 * `isAlive` test today; it only starts saying more once the sandbox signal (#5197) is threaded in.
 */
export const livenessBySession = (
    streams: SessionStream[] | null | undefined,
): Map<string, SessionLivenessBadge> | undefined => {
    if (streams === undefined || streams === null) return undefined
    const map = new Map<string, SessionLivenessBadge>()
    for (const stream of streams) {
        const nest = deriveStreamNest(stream)
        if (nest.isRunning) map.set(stream.session_id, "running")
        else if (nest.isAlive) map.set(stream.session_id, "alive")
    }
    return map
}
