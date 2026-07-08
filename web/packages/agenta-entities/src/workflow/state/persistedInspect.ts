/**
 * Disk-backed SWR for `inspectWorkflow` — the long pole of the agent-playground reload waterfall
 * (it leaves the Agenta API host and hits the agent-service container directly, and it gates which
 * config sections render). The inspect response is keyed by `uri + serviceUrl` (per SERVICE, shared
 * across a workflow's revisions), so one persisted entry serves every revision of an agent.
 *
 * Persisted so a reload paints the config sections from disk instantly, then revalidates once in the
 * background (`initialDataUpdatedAt: 0`) — a committed revision's config is immutable, but its
 * resolved schema can shift when the service redeploys, so we never pin it. Payloads are large, so
 * this uses a bounded LRU (per-entry storage + a small index) instead of one growing blob.
 *
 * Best-effort: any SSR / storage / parse / quota failure silently falls back to a normal fetch.
 */

const PREFIX = "agenta:inspect-swr"
// Bump to hard-invalidate every persisted inspect after a breaking response-shape change.
const VERSION = "1"
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
    try {
        const entry: PersistedInspectEntry<T> = {v: VERSION, data}
        window.localStorage.setItem(entryKey(key), JSON.stringify(entry))
        // LRU: move this key to the front, evict overflow entries.
        const index = [key, ...readIndex().filter((id) => id !== key)]
        for (const id of index.slice(MAX_ENTRIES)) {
            try {
                window.localStorage.removeItem(entryKey(id))
            } catch {
                // ignore
            }
        }
        window.localStorage.setItem(INDEX_KEY, JSON.stringify(index.slice(0, MAX_ENTRIES)))
    } catch {
        // quota / serialization — the cache is best-effort, so ignore.
    }
}
