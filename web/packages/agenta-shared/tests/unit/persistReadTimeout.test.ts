// fake-indexeddb must load before the module under test so `typeof indexedDB !== "undefined"`
import "fake-indexeddb/auto"

import type {PersistedQuery} from "@tanstack/query-persist-client-core"
import {hashKey} from "@tanstack/react-query"
import type {QueryKey} from "@tanstack/react-query"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {PERSIST_SCHEMA_VERSION} from "../../src/api/persist/version"

/**
 * The read the adapter performs, swappable per test. A real IndexedDB open that never settles is
 * what this guards against, and it cannot be reproduced through `fake-indexeddb` — the failure is
 * a promise that neither resolves nor rejects, so it has to be injected here.
 */
let getImpl: () => Promise<unknown> = async () => undefined

vi.mock("idb-keyval", async (importOriginal) => {
    const actual = await importOriginal<typeof import("idb-keyval")>()
    return {...actual, get: () => getImpl()}
})

const {idbQueryStorage} = await import("../../src/api/persist/idbStorage")

const makePersisted = (key: QueryKey, data: unknown): PersistedQuery => ({
    buster: PERSIST_SCHEMA_VERSION,
    queryHash: hashKey(key),
    queryKey: key,
    state: {
        data,
        dataUpdatedAt: Date.now(),
        dataUpdateCount: 1,
        error: null,
        errorUpdateCount: 0,
        errorUpdatedAt: 0,
        fetchFailureCount: 0,
        fetchFailureReason: null,
        fetchMeta: null,
        isInvalidated: false,
        status: "success",
        fetchStatus: "idle",
    },
})

beforeEach(() => {
    getImpl = async () => undefined
})

afterEach(() => {
    vi.useRealTimers()
})

describe("idb read timeout", () => {
    it("serves a cache miss when the read never settles", async () => {
        // The real failure: `indexedDB.open` fires neither success nor error, so idb-keyval's
        // promise hangs. `getItem` runs inside each query's persisterFn, ahead of its queryFn, so
        // a hang here means the query never fetches — no request, no error, pending forever.
        getImpl = () => new Promise<never>(() => {})
        vi.useFakeTimers()

        const read = idbQueryStorage.getItem("agenta-imm-hangs")
        await vi.advanceTimersByTimeAsync(3_000)

        await expect(read).resolves.toBeUndefined()
    })

    it("does not resolve before the timeout elapses", async () => {
        getImpl = () => new Promise<never>(() => {})
        vi.useFakeTimers()

        let settled = false
        const read = idbQueryStorage.getItem("agenta-imm-pending").then((value) => {
            settled = true
            return value
        })

        await vi.advanceTimersByTimeAsync(2_500)
        expect(settled).toBe(false)

        await vi.advanceTimersByTimeAsync(500)
        await read
        expect(settled).toBe(true)
    })

    it("still returns a value that arrives in time", async () => {
        const entry = makePersisted(["k"], {ok: true})
        getImpl = async () => entry

        await expect(idbQueryStorage.getItem("agenta-imm-fast")).resolves.toEqual(entry)
    })

    it("keeps degrading a rejected read to a cache miss", async () => {
        // The pre-existing contract: a storage FAILURE is a miss. The timeout must not change it.
        getImpl = async () => {
            throw new Error("idb exploded")
        }

        await expect(idbQueryStorage.getItem("agenta-imm-throws")).resolves.toBeUndefined()
    })
})
