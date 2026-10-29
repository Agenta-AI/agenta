import type {AsyncStorage, PersistedQuery} from "@tanstack/query-persist-client-core"
import {clear, createStore, del, entries, get, set} from "idb-keyval"
import type {UseStore} from "idb-keyval"

import {persistLog} from "./debug"

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

const IDB_READ_TIMEOUT_MS = 3_000

/**
 * Cap an IndexedDB read, because a hung one cannot be caught.
 *
 * `getItem` runs INSIDE the query's `persisterFn`, ahead of the real `queryFn`, so a read that
 * never settles means the query never fetches: enabled, no request, no error, `isPending` forever.
 * Every consumer of that query then sits on its loading state permanently — which is how the
 * agent's Configuration panel came to show its skeleton for good.
 *
 * IndexedDB does that whenever an open is BLOCKED (another tab holding the database at an older
 * version is the common one) — the request simply never fires `success` or `error`, so the promise
 * neither resolves nor rejects and the `try/catch` below can never see it. A timeout is the only
 * thing that can. Falling through to `undefined` is a cache miss, which is exactly what this
 * adapter already degrades to on every other storage failure.
 */
const withReadTimeout = async <T>(read: Promise<T>, key: string): Promise<T | undefined> => {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
        return await Promise.race([
            read,
            new Promise<undefined>((resolve) => {
                timer = setTimeout(() => {
                    persistLog("timeout", key)
                    resolve(undefined)
                }, IDB_READ_TIMEOUT_MS)
            }),
        ])
    } finally {
        if (timer !== undefined) clearTimeout(timer)
    }
}

/**
 * AsyncStorage adapter over IndexedDB for TanStack Query's per-query persister.
 * Stores PersistedQuery objects directly (structured clone) — no JSON round-trip.
 * All operations are best-effort: storage failures degrade to a cache miss.
 */
export const idbQueryStorage: AsyncStorage<PersistedQuery> = {
    getItem: async (key) => {
        const s = getStore()
        if (!s) return undefined
        try {
            const value = await withReadTimeout(get<PersistedQuery>(key, s), key)
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
        if (!s) return
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
