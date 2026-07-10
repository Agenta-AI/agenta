/**
 * Disk-backed SWR for `inspectWorkflow` — the long pole of the agent-playground reload waterfall
 * (it leaves the Agenta API host and hits the agent-service container directly, and it gates which
 * config sections render). The inspect response is keyed by `uri + serviceUrl` (per SERVICE, shared
 * across a workflow's revisions), so one persisted entry serves every revision of an agent.
 *
 * Persisted so a reload paints the config sections from disk instantly, then revalidates once in the
 * background (`initialDataUpdatedAt: 0`) — a committed revision's config is immutable, but its
 * resolved schema can shift when the service redeploys, so we never pin it. Payloads are large, so
 * this is bounded by a BYTE BUDGET (not an entry count): `localStorage` is a single ~5 MB budget
 * shared with auth-critical state (SuperTokens), and count-capping variable-size blobs lets the
 * cache silently monopolize the origin and starve other writers into a `QuotaExceededError`. We keep
 * the cache well under the origin limit, evict oldest-first to make room BEFORE writing, and purge
 * our own namespace if a write ever still hits quota — so this cache never leaves the origin full.
 *
 * Best-effort: any SSR / storage / parse / quota failure silently falls back to a normal fetch.
 */

const PREFIX = "agenta:inspect-swr"
// Bump to hard-invalidate every persisted inspect after a breaking response-shape change.
const VERSION = "1"
// Total budget for all inspect payloads, in JSON chars (~UTF-16 code units, the unit browsers
// meter localStorage in). ~1.2 MB of chars ≈ ~2.4 MB stored — a fraction of the ~5 MB origin, so
// auth + app state always keep headroom. A single payload larger than this is simply not cached.
const MAX_BYTES = 1_200_000
// Secondary hard cap so a pathological run of tiny payloads can't create unbounded index churn.
const MAX_ENTRIES = 15
const INDEX_KEY = `${PREFIX}:${VERSION}:__index`

const entryKey = (key: string) => `${PREFIX}:${VERSION}:${key}`

interface PersistedInspectEntry<T> {
    v: string
    data: T
}

function readIndex(): string[] {
    try {
        const raw = window.localStorage.getItem(INDEX_KEY)
        const parsed = raw ? JSON.parse(raw) : []
        return Array.isArray(parsed) ? (parsed as string[]) : []
    } catch {
        return []
    }
}

/** Drop the entire inspect namespace (every entry + the index). Used to self-heal on quota. */
function purgeInspectCache(): void {
    try {
        for (const id of readIndex()) {
            try {
                window.localStorage.removeItem(entryKey(id))
            } catch {
                // ignore
            }
        }
        window.localStorage.removeItem(INDEX_KEY)
    } catch {
        // ignore
    }
}

/**
 * TanStack query options to spread for a disk-seeded, background-revalidating inspect query.
 * Empty when nothing is persisted for `key` (or no `window`), so the query fetches normally.
 */
export function persistedInspectSeed<T>(key: string): {
    initialData?: T
    initialDataUpdatedAt?: number
} {
    if (typeof window === "undefined" || !key) return {}
    try {
        const raw = window.localStorage.getItem(entryKey(key))
        if (!raw) return {}
        const parsed = JSON.parse(raw) as PersistedInspectEntry<T>
        if (parsed?.v !== VERSION || parsed.data == null) return {}
        // Paint from disk immediately, but always revalidate once (schema can shift on redeploy).
        return {initialData: parsed.data, initialDataUpdatedAt: 0}
    } catch {
        return {}
    }
}

/** Persist a freshly-fetched inspect value. Call from the query's `queryFn` after a successful fetch. */
export function writePersistedInspect<T>(key: string, data: T): void {
    if (typeof window === "undefined" || !key || data == null) return

    const raw = JSON.stringify({v: VERSION, data} satisfies PersistedInspectEntry<T>)
    // A single payload over the whole budget is never worth caching (and can't be evicted into fit).
    if (raw.length > MAX_BYTES) return

    try {
        // Evict oldest-first to fit the byte budget BEFORE writing the new entry, so the cache never
        // transiently overflows and never depends on the write succeeding to run eviction.
        const kept: string[] = []
        let total = raw.length
        for (const id of readIndex()) {
            if (id === key) continue
            const existing = window.localStorage.getItem(entryKey(id))
            const size = existing ? existing.length : 0
            if (kept.length < MAX_ENTRIES - 1 && total + size <= MAX_BYTES) {
                kept.push(id)
                total += size
            } else {
                try {
                    window.localStorage.removeItem(entryKey(id))
                } catch {
                    // ignore
                }
            }
        }
        window.localStorage.setItem(entryKey(key), raw)
        window.localStorage.setItem(INDEX_KEY, JSON.stringify([key, ...kept]))
    } catch {
        // Quota despite the budget (origin already full from elsewhere): drop our whole namespace so
        // we free space and never leave the origin full for auth-critical writers. Best-effort cache.
        purgeInspectCache()
    }
}
