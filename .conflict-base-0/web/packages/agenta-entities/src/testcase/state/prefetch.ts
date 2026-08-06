/**
 * Cache-aware bulk-prefetch for testcases.
 *
 * The existing `fetchTestcasesBatch` api function already writes to the
 * shared TanStack cache (`["testcase", projectId, id]`) but never reads it
 * — so concurrent calls refetch everything. This wrapper closes that gap:
 *
 *   1. Read each requested id from the cache
 *   2. Partition into hits vs misses
 *   3. Bulk-fetch ONLY the misses
 *   4. Merge cached + fetched and return
 *
 * Co-existence with `fetchTestcasesBatch` is safe — it writes the same cache
 * keys after the network call, so newly-fetched rows land in the cache for
 * the next reader regardless of which path called it.
 *
 * @packageDocumentation
 */

import {getDefaultStore} from "jotai/vanilla"
import {queryClientAtom} from "jotai-tanstack-query"

import {fetchTestcasesBatch} from "../api"
import type {Testcase} from "../core"

function cacheKey(projectId: string, id: string) {
    return ["testcase", projectId, id] as const
}

function getQc() {
    return getDefaultStore().get(queryClientAtom)
}

export interface PrefetchTestcasesArgs {
    projectId: string
    testcaseIds: string[]
}

export interface PrefetchTestcasesOutcome {
    /** All testcases, keyed by id. Cached entries are merged with freshly fetched. */
    testcases: Map<string, Testcase>
    cacheHits: number
    cacheMisses: number
    fetchMs: number
}

export async function prefetchTestcasesByIds(
    args: PrefetchTestcasesArgs,
): Promise<PrefetchTestcasesOutcome> {
    const {projectId, testcaseIds} = args

    if (testcaseIds.length === 0) {
        return {testcases: new Map(), cacheHits: 0, cacheMisses: 0, fetchMs: 0}
    }

    let qc: ReturnType<typeof getQc> | null = null
    try {
        qc = getQc()
    } catch {
        // No Jotai store — degrade to full fetch
    }

    const out = new Map<string, Testcase>()
    const misses: string[] = []

    if (qc) {
        for (const id of testcaseIds) {
            const cached = qc.getQueryData<Testcase>(cacheKey(projectId, id))
            if (cached) {
                out.set(id, cached)
            } else {
                misses.push(id)
            }
        }
    } else {
        misses.push(...testcaseIds)
    }

    let fetchMs = 0
    if (misses.length > 0) {
        const start = performance.now()
        const fetched = await fetchTestcasesBatch({projectId, testcaseIds: misses})
        fetchMs = performance.now() - start
        fetched.forEach((tc, id) => out.set(id, tc))
        // fetchTestcasesBatch already writes to TanStack cache, so no extra work here.
    }

    return {
        testcases: out,
        cacheHits: testcaseIds.length - misses.length,
        cacheMisses: misses.length,
        fetchMs,
    }
}

/**
 * Invalidate a single testcase's cache entry — next read will refetch.
 */
export function invalidateTestcase({
    projectId,
    testcaseId,
}: {
    projectId: string
    testcaseId: string
}) {
    try {
        getQc().removeQueries({queryKey: cacheKey(projectId, testcaseId)})
    } catch {}
}

/**
 * Bulk-evict testcase cache entries — the per-chunk counterpart of
 * `prefetchTestcasesByIds`. An ETL chunk-release hook calls this once a
 * chunk is consumed so heap stays bounded by chunk size, not dataset
 * size. Returns the number of entries actually removed.
 */
export function evictTestcasesByIds({
    projectId,
    testcaseIds,
}: {
    projectId: string
    testcaseIds: string[]
}): number {
    let removed = 0
    try {
        const qc = getQc()
        for (const id of testcaseIds) {
            const key = cacheKey(projectId, id)
            if (qc.getQueryData(key) !== undefined) {
                qc.removeQueries({queryKey: key, exact: true})
                removed++
            }
        }
    } catch {
        // No queryClient — nothing to evict.
    }
    return removed
}
