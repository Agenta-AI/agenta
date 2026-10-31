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
import {revalidateSessionTurnsAtom, sessionTurnsQueryFamily} from "../../src/session/state/turns"

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
    // The read in flight saw the turn still running. Kept, its answer would cache `end_time: null`,
    // and a running turn starts no polling, so the footer would never get the turn's figures.
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
})
