import {projectIdAtom} from "@agenta/shared/state"
import {QueryClient} from "@tanstack/react-query"
import {createStore} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"
import {describe, expect, it, vi} from "vitest"

const {querySessionTurnsMock} = vi.hoisted(() => ({querySessionTurnsMock: vi.fn()}))

vi.mock("../../src/session/api/api", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../../src/session/api/api")>()
    return {...actual, querySessionTurns: querySessionTurnsMock}
})

import type {SessionTurn} from "../../src/session/core/schema"
import {
    revalidateSessionTurnsAtom,
    revalidateSessionTurnsOnTurnEndAtom,
    sessionTurnsQueryFamily,
} from "../../src/session/state/turns"

const SESSION_ID = "session-turns-refresh"

const running = [{trace_id: "t1", start_time: "2026-10-30T10:00:00Z", end_time: null}]
const ended = [
    {
        trace_id: "t1",
        start_time: "2026-10-30T10:00:00Z",
        end_time: "2026-10-30T10:00:05Z",
        usage: {total_tokens: 7, source: "runner"},
    },
]

const deferred = () => {
    let resolve: (turns: SessionTurn[]) => void = () => {}
    const promise = new Promise<SessionTurn[]>((done) => {
        resolve = done
    })
    return {promise, resolve}
}

const makeStore = () => {
    const store = createStore()
    store.set(queryClientAtom, new QueryClient())
    store.set(projectIdAtom, "project-1")
    return store
}

describe("the session turns refresh at a turn's end", () => {
    // A kept stale read would cache `end_time: null`, and a running turn starts no polling.
    it("follows a first read in flight with one more read", async () => {
        let answerStaleRead: (turns: SessionTurn[]) => void = () => {}
        querySessionTurnsMock
            .mockImplementationOnce(
                () =>
                    new Promise<SessionTurn[]>((resolve) => {
                        answerStaleRead = resolve
                    }),
            )
            .mockResolvedValueOnce(ended)
        const store = makeStore()
        const unsubscribe = store.sub(sessionTurnsQueryFamily(SESSION_ID), () => {})
        try {
            await vi.waitFor(() => expect(querySessionTurnsMock).toHaveBeenCalledTimes(1))

            store.set(revalidateSessionTurnsAtom, SESSION_ID)
            answerStaleRead(running as SessionTurn[])

            await vi.waitFor(() =>
                expect(store.get(sessionTurnsQueryFamily(SESSION_ID)).data).toEqual(ended),
            )
            expect(querySessionTurnsMock).toHaveBeenCalledTimes(2)
        } finally {
            unsubscribe()
        }
    })

    it("replaces a later read in flight that saw the turn running", async () => {
        const stale = deferred()
        querySessionTurnsMock.mockReset()
        querySessionTurnsMock
            .mockResolvedValueOnce(running)
            .mockImplementationOnce(() => stale.promise)
            .mockResolvedValueOnce(ended)
        const store = makeStore()
        const unsubscribe = store.sub(sessionTurnsQueryFamily(`${SESSION_ID}-2`), () => {})
        try {
            await vi.waitFor(() =>
                expect(store.get(sessionTurnsQueryFamily(`${SESSION_ID}-2`)).data).toEqual(running),
            )
            // Another refresh starts a read that sees the turn still running.
            void store.get(queryClientAtom).invalidateQueries({queryKey: ["session", "turns"]})
            await vi.waitFor(() => expect(querySessionTurnsMock).toHaveBeenCalledTimes(2))

            store.set(revalidateSessionTurnsAtom, `${SESSION_ID}-2`)
            stale.resolve(running as SessionTurn[])

            await vi.waitFor(() =>
                expect(store.get(sessionTurnsQueryFamily(`${SESSION_ID}-2`)).data).toEqual(ended),
            )
            expect(querySessionTurnsMock).toHaveBeenCalledTimes(3)
        } finally {
            unsubscribe()
        }
    })

    it("reads nothing for a running turn's records events, and once at its end", async () => {
        const sessionId = `${SESSION_ID}-3`
        querySessionTurnsMock.mockReset()
        querySessionTurnsMock.mockResolvedValueOnce(running).mockResolvedValue(ended)
        const store = makeStore()
        const unsubscribe = store.sub(sessionTurnsQueryFamily(sessionId), () => {})
        try {
            await vi.waitFor(() =>
                expect(store.get(sessionTurnsQueryFamily(sessionId)).data).toEqual(running),
            )
            const reads = querySessionTurnsMock.mock.calls.length

            // Tool calls and deltas of the running turn: no ended turn in the records.
            for (let event = 0; event < 6; event += 1) {
                store.set(revalidateSessionTurnsOnTurnEndAtom, {sessionId, endedTraceIds: []})
            }
            await new Promise((resolve) => setTimeout(resolve, 50))
            expect(querySessionTurnsMock.mock.calls.length).toBe(reads)

            // The turn ends, and later records events still show it ended.
            for (let event = 0; event < 3; event += 1) {
                store.set(revalidateSessionTurnsOnTurnEndAtom, {sessionId, endedTraceIds: ["t1"]})
            }
            await vi.waitFor(() =>
                expect(store.get(sessionTurnsQueryFamily(sessionId)).data).toEqual(ended),
            )
            store.set(revalidateSessionTurnsOnTurnEndAtom, {sessionId, endedTraceIds: ["t1"]})
            await new Promise((resolve) => setTimeout(resolve, 50))
            expect(querySessionTurnsMock.mock.calls.length).toBe(reads + 1)
        } finally {
            unsubscribe()
        }
    })

    // The runner flushes the terminal record before it completes the turn.
    it("reads again when the read at a turn's end still shows it running", async () => {
        const sessionId = `${SESSION_ID}-4`
        querySessionTurnsMock.mockReset()
        querySessionTurnsMock
            .mockResolvedValueOnce(running)
            .mockResolvedValueOnce(running)
            .mockResolvedValue(ended)
        const store = makeStore()
        const unsubscribe = store.sub(sessionTurnsQueryFamily(sessionId), () => {})
        try {
            await vi.waitFor(() => expect(querySessionTurnsMock).toHaveBeenCalledTimes(1))
            store.set(revalidateSessionTurnsOnTurnEndAtom, {sessionId, endedTraceIds: ["t1"]})
            await vi.waitFor(() => expect(querySessionTurnsMock).toHaveBeenCalledTimes(2))
            await new Promise((resolve) => setTimeout(resolve, 20))

            store.set(revalidateSessionTurnsOnTurnEndAtom, {sessionId, endedTraceIds: ["t1"]})

            await vi.waitFor(() =>
                expect(store.get(sessionTurnsQueryFamily(sessionId)).data).toEqual(ended),
            )
            expect(querySessionTurnsMock).toHaveBeenCalledTimes(3)
        } finally {
            unsubscribe()
        }
    })

    it("reads again after a failed read at a turn's end", async () => {
        const sessionId = `${SESSION_ID}-5`
        querySessionTurnsMock.mockReset()
        querySessionTurnsMock
            .mockResolvedValueOnce(running)
            // The read and its two retries fail.
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce(null)
            .mockResolvedValue(ended)
        const store = makeStore()
        const unsubscribe = store.sub(sessionTurnsQueryFamily(sessionId), () => {})
        try {
            await vi.waitFor(() => expect(querySessionTurnsMock).toHaveBeenCalledTimes(1))
            store.set(revalidateSessionTurnsOnTurnEndAtom, {sessionId, endedTraceIds: ["t1"]})
            await vi.waitFor(() => expect(querySessionTurnsMock).toHaveBeenCalledTimes(4), {
                timeout: 10_000,
            })
            await new Promise((resolve) => setTimeout(resolve, 20))

            store.set(revalidateSessionTurnsOnTurnEndAtom, {sessionId, endedTraceIds: ["t1"]})

            await vi.waitFor(() =>
                expect(store.get(sessionTurnsQueryFamily(sessionId)).data).toEqual(ended),
            )
        } finally {
            unsubscribe()
        }
    }, 20_000)
})
