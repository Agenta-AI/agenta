/**
 * Disk-backed SWR seed for the static workflow catalogs (ag-type schema, harness capabilities).
 *
 * These responses are global and immutable-per-key, so a cold page reload re-fetching them is pure
 * waterfall latency before the agent playground can paint its config sections / model picker. We
 * persist them to `localStorage` and feed the last value back as the query's `initialData`, so a
 * reload paints from cache INSTANTLY instead of waiting on the network.
 *
 * The seed is deliberately marked immediately stale (`initialDataUpdatedAt: 0`) rather than pinned
 * (`staleTime: Infinity`): the agent-template schema is still evolving, so on the first mount after
 * a reload the query paints from disk AND fires one background (non-blocking) revalidation that
 * rewrites the cache. A finite `staleTime` on the consuming query then dedupes in-session remounts.
 *
 * Best-effort: any SSR / storage / parse / quota failure silently falls back to a normal fetch.
 */

const CACHE_PREFIX = "agenta:catalog-swr"
// Bump to hard-invalidate every persisted catalog after a breaking response-shape change.
const CACHE_VERSION = "1"

interface PersistedCatalogEntry<T> {
    v: string
    ts: number
    data: T
}

const storageKey = (key: string) => `${CACHE_PREFIX}:${CACHE_VERSION}:${key}`

/**
 * TanStack query options to spread for a disk-seeded, background-revalidating catalog query.
 * Empty when there is nothing persisted (or no `window`), so the query fetches normally.
 */
export function persistedCatalogSeed<T>(key: string): {
    initialData?: T
    initialDataUpdatedAt?: number
} {
    if (typeof window === "undefined") return {}
    try {
        const raw = window.localStorage.getItem(storageKey(key))
        if (!raw) return {}
        const parsed = JSON.parse(raw) as PersistedCatalogEntry<T>
        if (parsed?.v !== CACHE_VERSION || parsed.data == null) return {}
        // `initialDataUpdatedAt: 0` = treat the disk value as ancient: paint from it immediately,
        // but always revalidate once on the first post-reload mount to catch schema changes.
        return {initialData: parsed.data, initialDataUpdatedAt: 0}
    } catch {
        return {}
    }
}

/** Persist a freshly-fetched catalog value. Call from the query's `queryFn` after a successful fetch. */
export function writePersistedCatalog<T>(key: string, data: T): void {
    if (typeof window === "undefined" || data == null) return
    try {
        const entry: PersistedCatalogEntry<T> = {v: CACHE_VERSION, ts: Date.now(), data}
        window.localStorage.setItem(storageKey(key), JSON.stringify(entry))
    } catch {
        // quota exceeded / serialization failure — the cache is best-effort, so ignore.
    }
}
