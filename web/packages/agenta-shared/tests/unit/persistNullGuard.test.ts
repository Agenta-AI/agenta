// fake-indexeddb must load before the module under test so `typeof indexedDB !== "undefined"`
import "fake-indexeddb/auto"

import type {PersistedQuery} from "@tanstack/query-persist-client-core"
import {hashKey} from "@tanstack/react-query"
import type {QueryKey} from "@tanstack/react-query"
import {createStore, get, set} from "idb-keyval"
import {beforeEach, describe, expect, it, vi} from "vitest"

import {clearPersistedQueryCache, idbQueryStorage} from "../../src/api/persist/idbStorage"
import {PERSIST_SCHEMA_VERSION} from "../../src/api/persist/version"

// Same DB/store the adapter uses — lets tests plant entries bypassing the setItem guard
const rawStore = createStore("agenta-query-cache", "queries")

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

beforeEach(async () => {
    await clearPersistedQueryCache()
})

describe("nullish-data guard", () => {
    it("setItem skips entries whose data is null or undefined", async () => {
        await idbQueryStorage.setItem("agenta-imm-null", makePersisted(["k1"], null))
        await idbQueryStorage.setItem("agenta-imm-undef", makePersisted(["k2"], undefined))
        expect(await get("agenta-imm-null", rawStore)).toBeUndefined()
        expect(await get("agenta-imm-undef", rawStore)).toBeUndefined()
    })

    it("setItem still writes falsy-but-real data (0, empty string, empty object)", async () => {
        await idbQueryStorage.setItem("agenta-imm-zero", makePersisted(["k3"], 0))
        await idbQueryStorage.setItem("agenta-imm-empty", makePersisted(["k4"], {}))
        expect(await idbQueryStorage.getItem("agenta-imm-zero")).toBeTruthy()
        expect(await idbQueryStorage.getItem("agenta-imm-empty")).toBeTruthy()
    })

    it("getItem treats a pre-existing null-data entry as a miss and evicts it", async () => {
        // Plant directly, bypassing the setItem guard (simulates entries persisted pre-guard)
        await set("agenta-imm-legacy", makePersisted(["k5"], null), rawStore)
        expect(await idbQueryStorage.getItem("agenta-imm-legacy")).toBeUndefined()
        await vi.waitFor(async () => {
            expect(await get("agenta-imm-legacy", rawStore)).toBeUndefined()
        })
    })
})
