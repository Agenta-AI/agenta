/**
 * A session's turns, the source of each chat turn's tokens, cost and latency: one read
 * per session instead of one trace read per turn, and readable by everyone who can read the
 * session, with or without trace access.
 */
import {projectIdAtom} from "@agenta/shared/state"
import {atom} from "jotai"
import {atomFamily} from "jotai-family"
import {atomWithQuery, queryClientAtom} from "jotai-tanstack-query"

import {querySessionTurns} from "../api/api"
import type {SessionTurn} from "../core/schema"
import {turnsByTraceId, turnsMayChange} from "../core/turnFigures"

export const sessionTurnsQueryKey = (projectId: string, sessionId: string) =>
    ["session", "turns", projectId, sessionId] as const

const SESSION_TURNS_STALE_MS = 15_000
/** Re-read while a turn that just ended waits for its figures from the trace. */
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

/** The session's turns by normalized trace id; empty until the turns load. */
export const sessionTurnsByTraceAtomFamily = atomFamily((sessionId: string) =>
    atom((get) => turnsByTraceId(get(sessionTurnsQueryFamily(sessionId)).data ?? [])),
)

/** Mark a session's turns stale (a finished turn has its end and its runner figures). Fire-and-
 * forget; `cancelRefetch: false` keeps a first read in flight. */
export const revalidateSessionTurnsAtom = atom(null, (get, _set, sessionId: string) => {
    const projectId = get(projectIdAtom) ?? ""
    if (!projectId || !sessionId) return
    void get(queryClientAtom).invalidateQueries(
        {queryKey: sessionTurnsQueryKey(projectId, sessionId)},
        {cancelRefetch: false},
    )
})
