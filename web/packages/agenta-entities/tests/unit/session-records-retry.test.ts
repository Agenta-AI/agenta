import {projectIdAtom} from "@agenta/shared/state"
import {QueryClient} from "@tanstack/react-query"
import {createStore} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const {querySessionRecordsMock} = vi.hoisted(() => ({querySessionRecordsMock: vi.fn()}))

vi.mock("../../src/session/api/api", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../../src/session/api/api")>()
    return {...actual, querySessionRecords: querySessionRecordsMock}
})

// IndexedDB persistence is not under test; without a persister the query reads the network only.
vi.mock("@agenta/shared/api/persist", () => ({recordsPersister: {persisterFn: undefined}}))

import type {SessionRecord} from "../../src/session/core/schema"
import {
    fetchSessionRecordsAtom,
    revalidateSessionRecordsAtom,
    sessionRecordsQueryFamily,
} from "../../src/session/state/records"

const PROJECT_ID = "proj-1"
const SESSION_ID = "session-1"
/** The Fern client's default per-request timeout. */
const CLIENT_TIMEOUT_MS = 30_000

const record = (id: string, text: string): SessionRecord =>
    ({
        id,
        session_id: SESSION_ID,
        project_id: PROJECT_ID,
        sequence: null,
        event_index: null,
        sender: "agent",
        session_update: "message",
        payload: {type: "message", text},
        turn_id: null,
        created_at: null,
    }) as SessionRecord

const finishedTurn = [record("r1", "older answer"), record("r2", "the finished answer")]

/** `querySessionRecords` answers a client timeout with `null` after the timeout elapses. */
const timesOut = () =>
    new Promise<null>((resolve) => setTimeout(() => resolve(null), CLIENT_TIMEOUT_MS))

function makeStore() {
    const queryClient = new QueryClient()
    const store = createStore()
    store.set(queryClientAtom, queryClient)
    store.set(projectIdAtom, PROJECT_ID)
    return {store, queryClient}
}

describe("session records read under a slow API", () => {
    beforeEach(() => {
        vi.useFakeTimers()
        querySessionRecordsMock.mockReset()
        sessionRecordsQueryFamily.setShouldRemove(() => true)
        sessionRecordsQueryFamily.setShouldRemove(null)
    })

    afterEach(() => {
        vi.useRealTimers()
    })

    it("retries reads that time out and still delivers the finished turn", async () => {
        querySessionRecordsMock
            .mockImplementationOnce(timesOut)
            .mockImplementationOnce(timesOut)
            .mockResolvedValueOnce(finishedTurn)
        const {store} = makeStore()

        const pending = store.set(fetchSessionRecordsAtom, SESSION_ID)
        await vi.advanceTimersByTimeAsync(2 * CLIENT_TIMEOUT_MS + 10_000)
        const {records} = await pending

        expect(querySessionRecordsMock).toHaveBeenCalledTimes(3)
        expect(records?.map((row) => row.id)).toEqual(["r1", "r2"])
    })

    it("keeps the last good log on screen when a revalidation times out", async () => {
        querySessionRecordsMock.mockResolvedValueOnce(finishedTurn).mockImplementation(timesOut)
        const {store, queryClient} = makeStore()
        const unsubscribe = store.sub(sessionRecordsQueryFamily(SESSION_ID), () => {})
        try {
            await vi.advanceTimersByTimeAsync(0)
            expect(store.get(sessionRecordsQueryFamily(SESSION_ID)).data).toEqual(finishedTurn)

            store.set(revalidateSessionRecordsAtom, SESSION_ID)
            // Every retry times out: the cache reports the error but keeps the log it had.
            await vi.advanceTimersByTimeAsync(4 * CLIENT_TIMEOUT_MS + 20_000)
            const state = queryClient.getQueryState(["session", "records", PROJECT_ID, SESSION_ID])
            expect(state?.status).toBe("error")
            expect(store.get(sessionRecordsQueryFamily(SESSION_ID)).data).toEqual(finishedTurn)
        } finally {
            unsubscribe()
        }
    })

    it("answers null once every retry has failed, the atom's read-failed contract", async () => {
        querySessionRecordsMock.mockImplementation(timesOut)
        const {store} = makeStore()

        const pending = store.set(fetchSessionRecordsAtom, SESSION_ID)
        await vi.advanceTimersByTimeAsync(4 * CLIENT_TIMEOUT_MS + 20_000)

        expect(await pending).toEqual({records: null})
        expect(querySessionRecordsMock).toHaveBeenCalledTimes(4)
    })
})
