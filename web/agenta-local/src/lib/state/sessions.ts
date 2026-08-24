import {queryClient} from "@agenta/shared/api"
import {atom} from "jotai"
import {atomWithQuery} from "jotai-tanstack-query"

import {localApi} from "@/lib/api/client"
import type {StreamFrame} from "@/lib/api/schemas"
import {parseEventStream} from "@/lib/api/stream"

export const sessionKeys = {
    all: ["local", "sessions"] as const,
    detail: (id: string) => ["local", "sessions", id] as const,
}
export const selectedSessionIdAtom = atom<string | null>(null)

export const sessionsQueryAtom = atomWithQuery(() => ({
    queryKey: sessionKeys.all,
    queryFn: localApi.listSessions,
    staleTime: 5_000,
    refetchOnWindowFocus: false,
}))

export const selectedSessionQueryAtom = atomWithQuery((get) => {
    const id = get(selectedSessionIdAtom)
    return {
        queryKey: sessionKeys.detail(id ?? "none"),
        queryFn: () => localApi.getSession(id!),
        enabled: Boolean(id),
    }
})

export async function createSession(agentRevisionId: string, title?: string) {
    const session = await localApi.createSession(agentRevisionId, title)
    queryClient.setQueryData(sessionKeys.detail(session.id), {...session, messages: []})
    await queryClient.invalidateQueries({queryKey: sessionKeys.all})
    return session
}

export async function* streamTurn(
    sessionId: string,
    text: string,
    clientTurnId: string,
    signal: AbortSignal,
): AsyncGenerator<StreamFrame> {
    const response = await localApi.turnRequest(sessionId, {text, clientTurnId}, signal)
    try {
        yield* parseEventStream(response, signal)
    } finally {
        await Promise.all([
            queryClient.invalidateQueries({queryKey: sessionKeys.detail(sessionId)}),
            queryClient.invalidateQueries({queryKey: sessionKeys.all}),
        ])
    }
}

export async function stopTurn(sessionId: string) {
    const result = await localApi.stopSession(sessionId)
    await queryClient.invalidateQueries({queryKey: sessionKeys.detail(sessionId)})
    return result
}

export interface TurnLock {
    activeClientTurnId: string | null
}
export const initialTurnLock: TurnLock = {activeClientTurnId: null}

export function beginTurn(lock: TurnLock, clientTurnId: string): TurnLock {
    return lock.activeClientTurnId ? lock : {activeClientTurnId: clientTurnId}
}

export function finishTurn(lock: TurnLock, clientTurnId: string): TurnLock {
    return lock.activeClientTurnId === clientTurnId ? initialTurnLock : lock
}
