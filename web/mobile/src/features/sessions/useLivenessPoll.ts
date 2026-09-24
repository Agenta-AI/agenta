import {
    livenessRefetchInterval,
    readAliveStreams,
    type SessionStream,
} from "@agenta/entities/session"
import {useQuery} from "@tanstack/react-query"

/** Shared key for the project liveness subscription. */
export const livenessQueryKey = (projectId: string) =>
    ["mobile", "session-liveness", projectId] as const

/**
 * Poll quickly while work runs, slowly while a session remains warm, and stop when idle.
 *
 * A failed read must not resolve `null`: cached as success, it read as "nothing alive", which
 * stopped the poll, so a turn running elsewhere never came back until a reload.
 */
export const useLivenessPoll = (projectId: string) =>
    useQuery<SessionStream[] | null>({
        queryKey: livenessQueryKey(projectId),
        queryFn: ({signal}) => readAliveStreams(projectId, signal),
        enabled: Boolean(projectId),
        staleTime: 10_000,
        refetchInterval: livenessRefetchInterval,
        refetchOnWindowFocus: true,
    })

/**
 * The poll's last-success timestamp, on its own.
 *
 * It changes on EVERY tick even when the payload is identical, so reading it from a component
 * that owns a wide subtree re-renders all of it once per poll. Only the conversation needs it.
 */
export const useLivenessUpdatedAt = (projectId: string): number =>
    useLivenessPoll(projectId).dataUpdatedAt

