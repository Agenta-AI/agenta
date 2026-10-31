/** A session's turns: each chat turn's tokens, cost and latency, in one read per session. */
import {projectIdAtom} from "@agenta/shared/state"
import {atom} from "jotai"
import {selectAtom} from "jotai/utils"
import {atomFamily} from "jotai-family"
import {atomWithQuery, queryClientAtom} from "jotai-tanstack-query"

import {querySessionTurns} from "../api/api"
import type {SessionTurn} from "../core/schema"
import {normalizeTraceId, turnsByTraceId, turnsMayChange} from "../core/turnFigures"

export const sessionTurnsQueryKey = (projectId: string, sessionId: string) =>
    ["session", "turns", projectId, sessionId] as const

const SESSION_TURNS_STALE_MS = 15_000
/** Re-read while a turn that just ended waits for its trace figures. */
const SESSION_TURNS_POLL_MS = 10_000

export const sessionTurnsQueryFamily = atomFamily((sessionId: string) =>
    atomWithQuery<SessionTurn[] | null>((get) => {
        const projectId = get(projectIdAtom) ?? ""
        return {
            queryKey: sessionTurnsQueryKey(projectId, sessionId),
            queryFn: async ({signal}) => {
                const turns = await querySessionTurns({sessionId, projectId, abortSignal: signal})
                if (turns === null) throw new Error("Session turns are unavailable")
                return turns
            },
            enabled: Boolean(sessionId && projectId),
            staleTime: SESSION_TURNS_STALE_MS,
            refetchOnWindowFocus: false,
            retry: 2,
            refetchInterval: (query) => {
                const turns = query.state.data
                return turns && turnsMayChange(turns) ? SESSION_TURNS_POLL_MS : false
            },
        }
    }),
)

// Selected fields, so a fetch-status change re-renders no footer.
const sessionTurnsDataAtomFamily = atomFamily((sessionId: string) =>
    selectAtom(sessionTurnsQueryFamily(sessionId), (query) => query.data),
)

/** The session's turns are still loading (the first read). */
export const sessionTurnsPendingAtomFamily = atomFamily((sessionId: string) =>
    selectAtom(sessionTurnsQueryFamily(sessionId), (query) => query.isLoading),
)

/** The session's turns by normalized trace id; empty until the turns load. */
export const sessionTurnsByTraceAtomFamily = atomFamily((sessionId: string) =>
    atom((get) => turnsByTraceId(get(sessionTurnsDataAtomFamily(sessionId)) ?? [])),
)

// Replaces a read in flight, which may cache a running turn and so start no polling.
// Resolves once the new read settles, success or failure.
export const revalidateSessionTurnsAtom = atom(
    null,
    (get, _set, sessionId: string): Promise<void> => {
        const projectId = get(projectIdAtom) ?? ""
        if (!projectId || !sessionId) return Promise.resolve()
        const client = get(queryClientAtom)
        const queryKey = sessionTurnsQueryKey(projectId, sessionId)
        const refetch = () => client.invalidateQueries({queryKey}, {cancelRefetch: true})
        const cache = client.getQueryCache()
        const query = cache.find({queryKey, exact: true})
        // TanStack Query cannot replace a first read (no data yet): read once more after it.
        if (query && query.state.data === undefined && query.state.fetchStatus !== "idle") {
            return new Promise((resolve) => {
                const unsubscribe = cache.subscribe((event) => {
                    if (event.query !== query || query.state.fetchStatus !== "idle") return
                    unsubscribe()
                    void refetch().finally(resolve)
                })
            })
        }
        return refetch()
    },
)

// Ended turns (by trace id) that need a read: absent from the cache, or cached as running.
const turnsNeedingRead = (keys: string[], cached: SessionTurn[] | null | undefined): string[] => {
    const endedByTrace = new Map<string, boolean>()
    for (const row of cached ?? []) {
        const key = normalizeTraceId(row.trace_id)
        if (key) endedByTrace.set(key, Boolean(row.end_time) || endedByTrace.get(key) === true)
    }
    return keys.filter((key) => key && endedByTrace.get(key) !== true)
}

// The runner writes the terminal record before it completes the turn, so a read can still see it
// running; it is read again after a pause, a few times at most.
const TURN_END_RETRY_MS = 3_000
const TURN_END_MAX_READS = 4

// One read at a time per session; ended turns seen meanwhile wait for it to settle.
const readingBySession = new Set<string>()
const waitingBySession = new Map<string, string[]>()

export const revalidateSessionTurnsOnTurnEndAtom = atom(
    null,
    (get, set, {sessionId, endedTraceIds}: {sessionId: string; endedTraceIds: string[]}) => {
        const projectId = get(projectIdAtom) ?? ""
        if (!projectId || !sessionId || endedTraceIds.length === 0) return
        const keys = endedTraceIds.map(normalizeTraceId)
        if (readingBySession.has(sessionId)) {
            waitingBySession.set(sessionId, keys)
            return
        }
        const client = get(queryClientAtom)
        const queryKey = sessionTurnsQueryKey(projectId, sessionId)
        const cachedTurns = () => client.getQueryData<SessionTurn[] | null>(queryKey)
        const read = (pending: string[], reads: number) => {
            if (turnsNeedingRead(pending, cachedTurns()).length === 0) {
                readingBySession.delete(sessionId)
                return
            }
            readingBySession.add(sessionId)
            void set(revalidateSessionTurnsAtom, sessionId).finally(() => {
                const next = [...pending, ...(waitingBySession.get(sessionId) ?? [])]
                waitingBySession.delete(sessionId)
                if (
                    reads >= TURN_END_MAX_READS ||
                    turnsNeedingRead(next, cachedTurns()).length === 0
                ) {
                    readingBySession.delete(sessionId)
                    return
                }
                setTimeout(() => read(next, reads + 1), TURN_END_RETRY_MS)
            })
        }
        read(keys, 1)
    },
)
