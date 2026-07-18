import type {AsyncStorage, PersistedQuery} from "@tanstack/query-persist-client-core"
import {clear, createStore, del, entries, get, set} from "idb-keyval"
import type {UseStore} from "idb-keyval"

import {isPersistDisabled, persistLog} from "./debug"

const DB_NAME = "agenta-query-cache"
const STORE_NAME = "queries"

let store: UseStore | null = null

/** Lazy store handle; null during SSR or when IndexedDB is unavailable. */
const getStore = (): UseStore | null => {
    if (typeof indexedDB === "undefined") return null
    if (!store) store = createStore(DB_NAME, STORE_NAME)
    return store
}

/** Nullish data must never persist: an immutable-restored `null` would suppress refetch forever. */
const hasPersistableData = (value: PersistedQuery): boolean =>
    value.state.data !== null && value.state.data !== undefined

/**
 * AsyncStorage adapter over IndexedDB for TanStack Query's per-query persister.
 * Stores PersistedQuery objects directly (structured clone) — no JSON round-trip.
 * All operations are best-effort: storage failures degrade to a cache miss.
 */
export const idbQueryStorage: AsyncStorage<PersistedQuery> = {
    getItem: async (key) => {
        const s = getStore()
        if (!s || isPersistDisabled()) return undefined
        try {
            const value = await get<PersistedQuery>(key, s)
            if (value !== undefined && !hasPersistableData(value)) {
                void del(key, s).catch(() => undefined)
                persistLog("evict", key)
                return undefined
            }
            persistLog(value === undefined ? "read-miss" : "read-hit", key, value)
            return value
        } catch {
            return undefined
        }
    },
    setItem: async (key, value) => {
        const s = getStore()
        if (!s || isPersistDisabled()) return
        if (!hasPersistableData(value)) {
            persistLog("skip", key)
            return
        }
        try {
            await set(key, value, s)
            persistLog("write", key, value)
        } catch {
            // best-effort: quota/serialization failures must never break the query
        }
    },
    removeItem: async (key) => {
        const s = getStore()
        if (!s) return
        try {
            await del(key, s)
            // The persister removes entries only when expired or buster-mismatched.
            persistLog("evict", key)
        } catch {
            // best-effort
        }
    },
    entries: async () => {
        const s = getStore()
        if (!s) return []
        try {
            return await entries<string, PersistedQuery>(s)
        } catch {
            return []
        }
    },
}

/** Drop every persisted query entry (call on logout / workspace teardown). */
export async function clearPersistedQueryCache(): Promise<void> {
    const s = getStore()
    if (!s) return
    try {
        await clear(s)
        persistLog("clear")
    } catch {
        // best-effort
    }
}
