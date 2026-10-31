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

const endedTurnNeedsRead = (key: string, cached: SessionTurn[] | null | undefined): boolean => {
    const turn = (cached ?? []).find((row) => normalizeTraceId(row.trace_id) === key)
    return !turn || !turn.end_time
}

// One read at a time per session; a turn still cached as running is read again on a later event.
const readingBySession = new Set<string>()

export const revalidateSessionTurnsOnTurnEndAtom = atom(
    null,
    (get, set, {sessionId, endedTraceIds}: {sessionId: string; endedTraceIds: string[]}) => {
        const projectId = get(projectIdAtom) ?? ""
        if (!projectId || !sessionId || endedTraceIds.length === 0) return
        if (readingBySession.has(sessionId)) return
        const client = get(queryClientAtom)
        const cached = client.getQueryData<SessionTurn[] | null>(
            sessionTurnsQueryKey(projectId, sessionId),
        )
        const needsRead = endedTraceIds
            .map(normalizeTraceId)
            .some((key) => key && endedTurnNeedsRead(key, cached))
        if (!needsRead) return
        readingBySession.add(sessionId)
        void set(revalidateSessionTurnsAtom, sessionId).finally(() => {
            readingBySession.delete(sessionId)
        })
    },
)
