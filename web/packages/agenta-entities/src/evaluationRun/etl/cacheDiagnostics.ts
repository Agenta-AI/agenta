/**
 * Diagnostic helpers for inspecting the shared TanStack Query cache.
 *
 * These are intentionally side-effect-free — they walk the cache and report
 * what's there. Use from PoC scripts, observability surfaces, or long-run
 * tests to bound memory empirically.
 *
 * Caveats:
 *   - "Bytes" is `JSON.stringify(data).length` — a rough proxy for in-memory
 *     size, not a true heap measurement. Good for relative comparisons and
 *     blow-up detection, not for accounting.
 *   - The cache is process-wide. If multiple runs/scopes are active, you'll
 *     see entries from all of them. Filter via `byPrefix` when you need
 *     scope isolation.
 *
 * @packageDocumentation
 */

import {getDefaultStore} from "jotai/vanilla"
import {queryClientAtom} from "jotai-tanstack-query"

import {
    inspectAtomFamilies,
    type AtomFamilyStats,
} from "../../shared/molecule/instrumentedAtomFamily"

export interface CacheSliceStats {
    /** First component of the cache key — e.g. "evaluation-results", "trace-entity", "testcase". */
    prefix: string
    /** Number of cache entries in this slice. */
    entries: number
    /** Approximate JSON-byte cost of all entries in this slice. */
    approxBytes: number
    /** Largest single entry (bytes). Useful for spotting outliers. */
    largestEntryBytes: number
}

export interface CacheDiagnostics {
    totalEntries: number
    totalApproxBytes: number
    /** Per-prefix breakdown, sorted by approxBytes descending. */
    slices: CacheSliceStats[]
}

function getQc() {
    return getDefaultStore().get(queryClientAtom)
}

/**
 * Default prefixes inspected by the diagnostic surface. Covers every TanStack
 * cache key the entity layer writes to, including the span-level cache that
 * `traceBatchFetcher` populates as a side-effect (separate from the trace-level
 * cache entry the prefetch action writes).
 *
 * Updating this list is the right move when adding a new entity-cache prefix.
 */
export const DEFAULT_DIAGNOSTIC_PREFIXES = [
    "evaluation-results",
    "evaluation-metrics",
    "testcase",
    "trace-entity",
    // Span-level cache — written by traceBatchFetcher when it materializes a
    // trace response. Each span in a trace gets its own cache entry under
    // `["span", projectId, spanId]`. Without this in the diagnostic list the
    // per-trace cost is under-counted.
    "span",
] as const

/**
 * Walk the TanStack cache, return per-prefix entry counts and approximate
 * byte sizes. Pass `prefixes` to restrict — defaults to `DEFAULT_DIAGNOSTIC_PREFIXES`.
 */
export function inspectCache(opts: {prefixes?: readonly string[]} = {}): CacheDiagnostics {
    let qc: ReturnType<typeof getQc> | null = null
    try {
        qc = getQc()
    } catch {
        return {totalEntries: 0, totalApproxBytes: 0, slices: []}
    }

    const queries = qc.getQueryCache().getAll()
    const bySlice = new Map<string, {entries: number; bytes: number; max: number}>()
    const prefixes = opts.prefixes ?? DEFAULT_DIAGNOSTIC_PREFIXES

    for (const q of queries) {
        const key = q.queryKey
        const prefix =
            Array.isArray(key) && typeof key[0] === "string" ? (key[0] as string) : "(unknown)"
        if (!prefixes.includes(prefix)) continue

        const data = q.state.data
        let bytes = 0
        try {
            bytes = data === undefined ? 0 : JSON.stringify(data).length
        } catch {
            bytes = 0
        }

        const slot = bySlice.get(prefix) ?? {entries: 0, bytes: 0, max: 0}
        slot.entries++
        slot.bytes += bytes
        if (bytes > slot.max) slot.max = bytes
        bySlice.set(prefix, slot)
    }

    const slices: CacheSliceStats[] = Array.from(bySlice.entries()).map(([prefix, s]) => ({
        prefix,
        entries: s.entries,
        approxBytes: s.bytes,
        largestEntryBytes: s.max,
    }))
    slices.sort((a, b) => b.approxBytes - a.approxBytes)

    return {
        totalEntries: slices.reduce((a, s) => a + s.entries, 0),
        totalApproxBytes: slices.reduce((a, s) => a + s.approxBytes, 0),
        slices,
    }
}

/**
 * Combined memory snapshot — TanStack cache + atom family sizes + heap.
 *
 * Useful as a one-liner in observability surfaces; produces a complete
 * "how much is the entity layer holding right now" answer.
 */
export interface MemorySnapshot {
    /** TanStack cache, per-prefix. */
    cache: CacheDiagnostics
    /** Active params per instrumented atom family. */
    atomFamilies: AtomFamilyStats[]
    /** Total params across every instrumented family — quick proxy for "atoms alive". */
    totalAtomFamilyEntries: number
    /** process.memoryUsage().heapUsed at snapshot time. */
    heapUsedBytes: number
}

export function inspectMemory(opts: {prefixes?: readonly string[]} = {}): MemorySnapshot {
    const cache = inspectCache(opts)
    const atomFamilies = inspectAtomFamilies()
    const totalAtomFamilyEntries = atomFamilies.reduce((a, f) => a + f.size, 0)
    return {
        cache,
        atomFamilies,
        totalAtomFamilyEntries,
        heapUsedBytes: typeof process !== "undefined" ? process.memoryUsage().heapUsed : 0,
    }
}

/**
 * Walk the cache and remove all entries matching any of the given prefixes.
 * Returns the number of entries removed. Use this for explicit teardown in
 * scripts or after a run finishes.
 */
export function clearCacheByPrefix(prefixes: string[]): number {
    let qc: ReturnType<typeof getQc> | null = null
    try {
        qc = getQc()
    } catch {
        return 0
    }
    const cache = qc.getQueryCache()
    const queries = cache.getAll()
    let removed = 0
    for (const q of queries) {
        const key = q.queryKey
        const prefix = Array.isArray(key) && typeof key[0] === "string" ? key[0] : null
        if (prefix && prefixes.includes(prefix)) {
            cache.remove(q)
            removed++
        }
    }
    return removed
}
