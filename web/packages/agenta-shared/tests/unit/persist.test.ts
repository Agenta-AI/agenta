// fake-indexeddb must load before the module under test so `typeof indexedDB !== "undefined"`
import "fake-indexeddb/auto"

import type {PersistedQuery} from "@tanstack/query-persist-client-core"
import {QueryClient, QueryObserver, hashKey} from "@tanstack/react-query"
import type {QueryKey, QueryPersister} from "@tanstack/react-query"
import {beforeEach, describe, expect, it, vi} from "vitest"

import {clearPersistedQueryCache, idbQueryStorage} from "../../src/api/persist/idbStorage"
import {catalogPersister, immutablePersister} from "../../src/api/persist/persisters"
import {PERSIST_SCHEMA_VERSION} from "../../src/api/persist/version"

const DAY_MS = 24 * 60 * 60 * 1000

const newClient = () =>
    new QueryClient({defaultOptions: {queries: {retry: false, gcTime: Number.POSITIVE_INFINITY}}})

// persist-client-core bundles its own query-core copy, so its persisterFn signature is
// structurally identical but nominally distinct from react-query's QueryPersister
const asPersister = <T,>(fn: typeof immutablePersister.persisterFn): QueryPersister<T> =>
    fn as unknown as QueryPersister<T>

// persistQueryByKey's QueryClient type also comes from the bundled query-core copy
type PersisterClient = Parameters<typeof immutablePersister.persistQueryByKey>[1]

// a queryFn that must never run; retry:false makes any call fail the test loudly
const neverFetch = <T,>() =>
    vi.fn(async (): Promise<T> => {
        throw new Error("unexpected fetch")
    })

const immStorageKey = (key: QueryKey) => `agenta-imm-${hashKey(key)}`
const catStorageKey = (key: QueryKey) => `agenta-cat-${hashKey(key)}`

// persistQuery / afterRestore run on notifyManager.schedule (setTimeout 0)
const flushMacrotasks = async (rounds = 3) => {
    for (let i = 0; i < rounds; i++) {
        await new Promise((resolve) => setTimeout(resolve, 5))
    }
}

const listEntries = async () => (await idbQueryStorage.entries?.()) ?? []

const waitForStored = async (storageKey: string): Promise<PersistedQuery> => {
    await vi.waitFor(async () => {
        expect(await idbQueryStorage.getItem(storageKey)).toBeTruthy()
    })
    const entry = await idbQueryStorage.getItem(storageKey)
    if (!entry) throw new Error(`expected persisted entry at ${storageKey}`)
    return entry
}

const mutateStored = async (
    storageKey: string,
    mutate: (entry: PersistedQuery) => PersistedQuery,
): Promise<void> => {
    const entry = await idbQueryStorage.getItem(storageKey)
    if (!entry) throw new Error(`expected persisted entry at ${storageKey}`)
    await idbQueryStorage.setItem(storageKey, mutate(entry))
}

const agedCopy = (entry: PersistedQuery, dataUpdatedAt: number): PersistedQuery => ({
    ...entry,
    state: {...entry.state, dataUpdatedAt},
})

const makePersisted = (key: QueryKey, data: unknown, dataUpdatedAt = Date.now()): PersistedQuery => ({
    buster: PERSIST_SCHEMA_VERSION,
    queryHash: hashKey(key),
    queryKey: key,
    state: {
        data,
        dataUpdateCount: 1,
        dataUpdatedAt,
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

beforeEach(async () => {
    await clearPersistedQueryCache()
})

describe("idbQueryStorage round-trip", () => {
    it("setItem/getItem/removeItem/entries round-trip PersistedQuery objects", async () => {
        const key: QueryKey = ["rt", 1]
        const persisted = makePersisted(key, {hello: "world", nested: [1, 2, 3]})

        await idbQueryStorage.setItem("rt-key", persisted)
        expect(await idbQueryStorage.getItem("rt-key")).toEqual(persisted)

        const entries = await listEntries()
        expect(entries).toEqual([["rt-key", persisted]])

        await idbQueryStorage.removeItem("rt-key")
        expect(await idbQueryStorage.getItem("rt-key")).toBeUndefined()
        expect(await listEntries()).toEqual([])
    })

    it("getItem of a missing key returns undefined", async () => {
        expect(await idbQueryStorage.getItem("never-written")).toBeUndefined()
    })
})

describe("immutablePersister (Class A)", () => {
    it("restores on a fresh client without refetching and keeps the original dataUpdatedAt", async () => {
        const key: QueryKey = ["imm", "class-a"]
        const body = {id: "rev-1", config: {prompts: ["a", "b"]}}

        const clientA = newClient()
        const spyA = vi.fn(async () => body)
        const first = await clientA.fetchQuery({
            queryKey: key,
            queryFn: spyA,
            persister: asPersister<typeof body>(immutablePersister.persisterFn),
            staleTime: Number.POSITIVE_INFINITY,
        })
        expect(first).toEqual(body)
        expect(spyA).toHaveBeenCalledTimes(1)

        // persistQuery runs on a macrotask after the fetch resolves
        const stored = await waitForStored(immStorageKey(key))
        expect(stored.buster).toBe(PERSIST_SCHEMA_VERSION)
        expect(stored.state.data).toEqual(body)

        // age the stored timestamp so we can prove restore keeps it
        const agedAt = Date.now() - 3_600_000
        await idbQueryStorage.setItem(immStorageKey(key), agedCopy(stored, agedAt))

        // fresh client = simulated reload
        const clientB = newClient()
        const spyB = neverFetch<typeof body>()
        const restored = await clientB.fetchQuery({
            queryKey: key,
            queryFn: spyB,
            persister: asPersister<typeof body>(immutablePersister.persisterFn),
            staleTime: Number.POSITIVE_INFINITY,
        })
        expect(restored).toEqual(body)
        expect(spyB).not.toHaveBeenCalled()

        // afterRestore macrotask: restores timestamps; refetchOnRestore=false → no fetch
        await flushMacrotasks()
        expect(spyB).not.toHaveBeenCalled()
        expect(clientB.getQueryState(key)?.dataUpdatedAt).toBe(agedAt)
    })

    it("restores entries far older than 14d (maxAge Infinity)", async () => {
        const key: QueryKey = ["imm", "ancient"]
        const body = {id: "rev-old"}
        await idbQueryStorage.setItem(
            immStorageKey(key),
            makePersisted(key, body, Date.now() - 15 * DAY_MS),
        )

        const client = newClient()
        const spy = neverFetch<typeof body>()
        const restored = await client.fetchQuery({
            queryKey: key,
            queryFn: spy,
            persister: asPersister<typeof body>(immutablePersister.persisterFn),
            staleTime: Number.POSITIVE_INFINITY,
        })
        expect(restored).toEqual(body)
        await flushMacrotasks()
        expect(spy).not.toHaveBeenCalled()
    })
})

describe("catalogPersister (Class B)", () => {
    it("observer paints restored data first, then exactly one background refetch", async () => {
        const key: QueryKey = ["cat", "models"]
        const staleBody = {models: ["gpt-4"]}
        const freshBody = {models: ["gpt-4", "gpt-5"]}

        const clientA = newClient()
        await clientA.fetchQuery({
            queryKey: key,
            queryFn: async () => staleBody,
            persister: asPersister<typeof staleBody>(catalogPersister.persisterFn),
            staleTime: 60_000,
        })
        const stored = await waitForStored(catStorageKey(key))

        // age past staleTime but within maxAge → restore succeeds, then revalidates
        await idbQueryStorage.setItem(catStorageKey(key), agedCopy(stored, Date.now() - 120_000))

        const clientB = newClient()
        const spy = vi.fn(async () => freshBody)
        const observer = new QueryObserver<typeof staleBody>(clientB, {
            queryKey: key,
            queryFn: spy,
            persister: asPersister<typeof staleBody>(catalogPersister.persisterFn),
            staleTime: 60_000,
            retry: false,
        })
        const seen: unknown[] = []
        const unsubscribe = observer.subscribe((result) => {
            if (result.data !== undefined) seen.push(result.data)
        })

        try {
            // restored data arrives before any network result
            await vi.waitFor(() => expect(seen.length).toBeGreaterThan(0))
            expect(seen[0]).toEqual(staleBody)

            // one background revalidate fires because the restored entry is stale
            await vi.waitFor(() => expect(spy).toHaveBeenCalledTimes(1))
            await vi.waitFor(() =>
                expect(observer.getCurrentResult().data).toEqual(freshBody),
            )
            await flushMacrotasks()
            expect(spy).toHaveBeenCalledTimes(1)
        } finally {
            unsubscribe()
        }
    })

    it("fetchQuery alone (no observer) restores but does NOT background-refetch", async () => {
        const key: QueryKey = ["cat", "no-observer"]
        const staleBody = {v: "old"}
        await idbQueryStorage.setItem(
            catStorageKey(key),
            makePersisted(key, staleBody, Date.now() - 120_000),
        )

        const client = newClient()
        const spy = vi.fn(async () => ({v: "new"}))
        const restored = await client.fetchQuery({
            queryKey: key,
            queryFn: spy,
            persister: asPersister<typeof staleBody>(catalogPersister.persisterFn),
            staleTime: 60_000,
        })
        expect(restored).toEqual(staleBody)

        // without observers Query.isStale() is false when data exists → no revalidate
        await flushMacrotasks()
        expect(spy).not.toHaveBeenCalled()
    })

    it("discards entries older than 14d and takes the network path", async () => {
        const key: QueryKey = ["cat", "expired"]
        const freshBody = {v: "fresh"}
        await idbQueryStorage.setItem(
            catStorageKey(key),
            makePersisted(key, {v: "expired"}, Date.now() - 15 * DAY_MS),
        )

        const client = newClient()
        const spy = vi.fn(async () => freshBody)
        const result = await client.fetchQuery({
            queryKey: key,
            queryFn: spy,
            persister: asPersister<typeof freshBody>(catalogPersister.persisterFn),
            staleTime: 60_000,
        })
        expect(result).toEqual(freshBody)
        expect(spy).toHaveBeenCalledTimes(1)

        // stale entry was dropped, fresh fetch re-persisted
        const stored = await waitForStored(catStorageKey(key))
        expect(stored.state.data).toEqual(freshBody)
    })
})

describe("buster mismatch", () => {
    it("discards the stale entry, fetches, and re-persists with the current buster", async () => {
        const key: QueryKey = ["imm", "busted"]
        const freshBody = {id: "new-shape"}

        await idbQueryStorage.setItem(immStorageKey(key), {
            ...makePersisted(key, {id: "old-shape"}),
            buster: "v0",
        })

        const client = newClient()
        const spy = vi.fn(async () => freshBody)
        const result = await client.fetchQuery({
            queryKey: key,
            queryFn: spy,
            persister: asPersister<typeof freshBody>(immutablePersister.persisterFn),
            staleTime: Number.POSITIVE_INFINITY,
        })
        expect(result).toEqual(freshBody)
        expect(spy).toHaveBeenCalledTimes(1)

        await vi.waitFor(async () => {
            const stored = await idbQueryStorage.getItem(immStorageKey(key))
            expect(stored?.buster).toBe(PERSIST_SCHEMA_VERSION)
            expect(stored?.state.data).toEqual(freshBody)
        })
    })
})

describe("persistQueryByKey", () => {
    it("persists data primed via setQueryData; fresh client restores without fetching", async () => {
        const key: QueryKey = ["imm", "primed"]
        const body = {id: "primed-rev", payload: {x: 1}}

        const clientA = newClient()
        clientA.setQueryData(key, body)
        // dual query-core instances make the QueryClient types nominally incompatible
        await immutablePersister.persistQueryByKey(key, clientA as unknown as PersisterClient)

        // setItem inside persistQuery is fire-and-forget; poll until written
        const stored = await waitForStored(immStorageKey(key))
        expect(stored.state.data).toEqual(body)
        expect(stored.buster).toBe(PERSIST_SCHEMA_VERSION)

        const clientB = newClient()
        const spy = neverFetch<typeof body>()
        const restored = await clientB.fetchQuery({
            queryKey: key,
            queryFn: spy,
            persister: asPersister<typeof body>(immutablePersister.persisterFn),
            staleTime: Number.POSITIVE_INFINITY,
        })
        expect(restored).toEqual(body)
        await flushMacrotasks()
        expect(spy).not.toHaveBeenCalled()
    })
})

describe("clearPersistedQueryCache", () => {
    it("drops every entry", async () => {
        await idbQueryStorage.setItem("agenta-imm-a", makePersisted(["a"], 1))
        await idbQueryStorage.setItem("agenta-cat-b", makePersisted(["b"], 2))
        expect((await listEntries()).length).toBe(2)

        await clearPersistedQueryCache()
        expect(await listEntries()).toEqual([])
    })
})

describe("SSR guard (no indexedDB)", () => {
    it("all storage methods resolve harmlessly", async () => {
        vi.resetModules()
        vi.stubGlobal("indexedDB", undefined)
        try {
            const mod = await import("../../src/api/persist/idbStorage")
            await expect(
                Promise.resolve(mod.idbQueryStorage.getItem("k")),
            ).resolves.toBeUndefined()
            await expect(
                Promise.resolve(mod.idbQueryStorage.setItem("k", makePersisted(["k"], 1))),
            ).resolves.toBeUndefined()
            await expect(Promise.resolve(mod.idbQueryStorage.removeItem("k"))).resolves.toBeUndefined()
            await expect(Promise.resolve(mod.idbQueryStorage.entries?.())).resolves.toEqual([])
            await expect(mod.clearPersistedQueryCache()).resolves.toBeUndefined()
        } finally {
            vi.unstubAllGlobals()
            vi.resetModules()
        }
    })
})
