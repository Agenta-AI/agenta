/**
 * Combined leak test — `makeSourceFromPaginatedStore` + molecule layer.
 *
 * Restored from `@agenta/entities/src/etl/__tests__/runLoop.combinedLeak.test.ts`
 * (the "Combined leak: paginatedStore + molecule layer" describe block), which
 * was dropped when the eval-run ETL moved to `@agenta/evaluations` (WP-3.5a) —
 * keeping it in entities would have created an entities→evaluations cycle.
 * It now lives here, importing `cacheDiagnostics` from this package and the
 * generic primitives from `@agenta/entities/*` public subpaths.
 *
 * The entities engine leak test (`runLoop.leak.test.ts`) exercises the
 * runtime with synthetic Source/Sink. The molecule leak test
 * (`molecules.leak.test.ts`) exercises the TanStack cache layer in
 * isolation. Neither covers the COMBINATION — running the real paginated
 * source adapter alongside the molecule-backed hydrate fetchers, iteration
 * after iteration.
 *
 * What this test catches:
 *
 *   1. `atomFamily(scopeId)` retention inside `createPaginatedEntityStore`
 *      — every fresh `scopeId` adds an entry to the paginated store's
 *      controller atom family. Without `dispose()` (or scopeId reuse),
 *      it grows unboundedly across pipeline runs.
 *
 *   2. TanStack cache growth from the cumulative effect of result/metric
 *      writes plus the paginated store's own queries, which only release
 *      if the caller explicitly evicts/disposes.
 *
 * Adaptations from the original longrun version:
 *
 *   - `node:test` → vitest (this package's standard runner); assertions
 *     stay on `node:assert/strict`.
 *   - SCALED DOWN: 50 iterations → 12, heap sampled every 2 iterations
 *     (was every 5), to keep the unit suite fast (<10s). The leak property
 *     is structural — atom-family params and cache entries must return to
 *     baseline after each iteration's teardown — so it holds at any
 *     iteration count; 12 is enough to expose monotonic growth.
 *   - The heap-slope assertion needs `--expose-gc`, which vitest does not
 *     enable by default. Instead of skipping the whole test (the original
 *     behavior), the structural assertions (atoms + cache drained, no
 *     monotonic growth) ALWAYS run; the heap-slope budget is asserted only
 *     when `gc` is available.
 */

import assert from "node:assert/strict"

import {makeSourceFromPaginatedStore, runLoop} from "@agenta/entities/etl"
import type {Sink, Transform} from "@agenta/entities/etl"
import {evaluationMetricMolecule, evaluationResultMolecule} from "@agenta/entities/evaluationRun"
import {
    clearAllAtomFamilies,
    createPaginatedEntityStore,
    inspectAtomFamilies,
} from "@agenta/entities/shared"
import {QueryClient} from "@tanstack/react-query"
import {atom, getDefaultStore} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"
import {describe, it} from "vitest"

import {clearCacheByPrefix, inspectCache} from "../../src/etl/cacheDiagnostics"

const hasGc = typeof (globalThis as {gc?: () => void}).gc === "function"
const forceGc = () => (globalThis as {gc?: () => void}).gc?.()

const store = getDefaultStore()

function installQc(): QueryClient {
    const qc = new QueryClient({
        defaultOptions: {queries: {retry: false, gcTime: Infinity, staleTime: Infinity}},
    })
    store.set(queryClientAtom, qc)
    return qc
}

// `InfiniteTableRowBase` requires `key` and a `[key: string]: unknown` index
// signature — we mirror `id` into `key` so the rest of the test code can stay
// id-keyed.
interface FakeRow {
    key: string
    id: string
    status: string
    run_id: string
    [k: string]: unknown
}

// `BaseTableMeta` requires `projectId` — null is fine for the synthetic
// store because we override `isEnabled` below to skip the projectId check.
interface FakeMeta {
    projectId: string | null
    runId: string
}

/**
 * Build a paginated store backed by an in-memory page generator. Used to
 * exercise makeSourceFromPaginatedStore without hitting the network.
 *
 * The default `isEnabled` predicate of `createPaginatedEntityStore` looks
 * for `meta.projectId` — our synthetic meta uses only `runId`, so we
 * override `isEnabled` to always allow the fetch.
 */
function buildSyntheticStore(scopeRunId: string, totalRows: number, pageSize: number) {
    const metaAtom = atom<FakeMeta>({projectId: null, runId: scopeRunId})
    return createPaginatedEntityStore<FakeRow, FakeRow, FakeMeta>({
        entityName: `synthetic-${scopeRunId}`,
        metaAtom,
        isEnabled: () => true,
        fetchPage: async ({meta, limit, cursor}) => {
            const startIdx = cursor ? parseInt(cursor, 10) : 0
            const endIdx = Math.min(startIdx + limit, totalRows)
            const rows: FakeRow[] = []
            for (let i = startIdx; i < endIdx; i++) {
                const rowId = `${meta.runId}-row-${i}`
                rows.push({key: rowId, id: rowId, status: "success", run_id: meta.runId})
            }
            const nextCursor = endIdx < totalRows ? String(endIdx) : null
            return {
                rows,
                totalCount: totalRows,
                hasMore: !!nextCursor,
                nextCursor,
                nextOffset: null,
                nextWindowing: null,
            }
        },
        rowConfig: {
            getRowId: (r) => r.id,
            skeletonDefaults: {} as Partial<FakeRow>,
        },
    })
}

function regressionSlope(samples: number[]): number {
    if (samples.length < 2) return 0
    const n = samples.length
    const xs = samples.map((_, i) => i)
    const meanX = xs.reduce((a, b) => a + b, 0) / n
    const meanY = samples.reduce((a, b) => a + b, 0) / n
    const num = xs.reduce((acc, x, i) => acc + (x - meanX) * (samples[i] - meanY), 0)
    const den = xs.reduce((acc, x) => acc + (x - meanX) ** 2, 0)
    return den === 0 ? 0 : num / den
}

// =============================================================================
// Main: 12-iteration combined pipeline WITH teardown (scaled from 50 — see
// header comment). Structural drain assertions always run; the heap-slope
// budget additionally applies when --expose-gc is available.
// =============================================================================

describe("Combined leak: paginatedStore + molecule layer", () => {
    it(
        "12 iterations WITH teardown: atoms + cache drained between runs (heap slope ≈ 0 when gc available)",
        {timeout: 90_000},
        async () => {
            installQc()
            const ITERATIONS = 12
            const ROWS_PER_RUN = 40
            const PAGE_SIZE = 20
            const SAMPLE_EVERY = 2
            const PROJECT_ID = "p1"

            forceGc()
            const samples: number[] = []
            const atomSamples: number[] = []
            const cacheSamples: number[] = []

            for (let iter = 0; iter < ITERATIONS; iter++) {
                const runId = `combined-run-${iter}`
                const scenariosStore = buildSyntheticStore(runId, ROWS_PER_RUN, PAGE_SIZE)

                // Source via the real paginated-store adapter (this is what
                // grows the atomFamily inside createPaginatedEntityStore)
                const source = makeSourceFromPaginatedStore<FakeRow>(scenariosStore, {
                    scopeId: `combined-scope-${iter}`,
                    pageSize: PAGE_SIZE,
                })

                const passthrough: Transform<FakeRow, FakeRow> = (chunk) => chunk
                const sink: Sink<FakeRow> = {
                    async load(chunk) {
                        // Touch the molecule layer to populate TanStack cache.
                        // Use chunk's row ids as fake scenarioIds so the cache
                        // entries are unique per iteration.
                        const scenarioIds = chunk.items.map((r) => r.id)
                        // Seed cache directly (avoids network for synthetic test)
                        const qc = store.get(queryClientAtom)
                        for (const sid of scenarioIds) {
                            qc.setQueryData(
                                ["evaluation-results", PROJECT_ID, runId, sid],
                                [
                                    {
                                        run_id: runId,
                                        scenario_id: sid,
                                        step_key: "x",
                                        status: "ok",
                                    },
                                ],
                            )
                            qc.setQueryData(
                                ["evaluation-metrics", PROJECT_ID, runId, sid],
                                [{id: sid, run_id: runId, scenario_id: sid, status: "ok"}],
                            )
                        }
                        // Now exercise the molecule reads
                        await evaluationResultMolecule.actions.prefetchByScenarioIds({
                            projectId: PROJECT_ID,
                            runId,
                            scenarioIds,
                        })
                        await evaluationMetricMolecule.actions.prefetchByScenarioIds({
                            projectId: PROJECT_ID,
                            runId,
                            scenarioIds,
                        })
                        return {loadedCount: chunk.items.length}
                    },
                }

                for await (const _ of runLoop(source, [passthrough], sink, undefined)) {
                    // drain
                }

                // TEARDOWN — release everything we created this iteration.
                evaluationResultMolecule.actions.evictByRunId({projectId: PROJECT_ID, runId})
                evaluationMetricMolecule.actions.evictByRunId({projectId: PROJECT_ID, runId})
                clearCacheByPrefix(["testcase", "trace-entity", "span"])
                // The paginated store owns its own atomFamily registry AND
                // its TanStack queries. dispose() releases both — the
                // internal atom families + every cache entry keyed by the
                // store's `options.key`. Without this, ~70 KB/iter
                // accumulates from TanStack observer state for retired
                // scopeIds. WITH dispose(), the combined slope is ~3 KB/iter
                // (flat — GC noise floor).
                scenariosStore.dispose()
                // Also clear any globally-registered families (trace store etc.)
                clearAllAtomFamilies()

                if (iter > 1 && iter % SAMPLE_EVERY === 0) {
                    forceGc()
                    samples.push(process.memoryUsage().heapUsed)
                    atomSamples.push(inspectAtomFamilies().reduce((a, f) => a + f.size, 0))
                    cacheSamples.push(inspectCache().totalEntries)
                }
            }

            console.log(`  atom family params at each sample: [${atomSamples.join(", ")}]`)
            console.log(`  TanStack cache entries at each sample: [${cacheSamples.join(", ")}]`)

            // STRUCTURAL leak property (always asserted, no gc needed):
            // repeated paginatedStore + molecule usage must NOT monotonically
            // grow atom-family / query-cache entries once disposed/cleared.

            // Atom family params should stabilize near zero post-teardown.
            // We allow some slack because each iteration's teardown runs
            // BEFORE the next iteration's allocations.
            const lastAtomSample = atomSamples[atomSamples.length - 1] ?? 0
            assert.ok(lastAtomSample < 50, `Atom family params not draining: ${atomSamples}`)

            // Cache entries post-teardown should be flat at a small baseline —
            // growth across samples means evict/dispose stopped releasing.
            const firstCacheSample = cacheSamples[0] ?? 0
            const lastCacheSample = cacheSamples[cacheSamples.length - 1] ?? 0
            assert.ok(
                lastCacheSample <= firstCacheSample,
                `TanStack cache entries growing across iterations despite teardown: ${cacheSamples}`,
            )
            assert.ok(
                lastCacheSample < 50,
                `TanStack cache entries not draining to baseline: ${cacheSamples}`,
            )

            // HEAP leak property (only meaningful with --expose-gc).
            if (hasGc) {
                const slopeBytesPerSample = regressionSlope(samples)
                const slopeBytesPerIter = slopeBytesPerSample / SAMPLE_EVERY
                // Tight budget: once `paginatedStore.dispose()` was added
                // (with TanStack query removal), measured slope is ~3 KB/iter.
                // The budget is set to 30 KB to leave headroom for GC noise
                // but catch any future regression from the dispose path
                // breaking.
                const BUDGET_KB_PER_ITER = 30

                console.log(
                    `  heap samples (MB): [${samples.map((s) => (s / 1024 / 1024).toFixed(1)).join(", ")}]`,
                )
                console.log(
                    `  heap slope: ${(slopeBytesPerIter / 1024).toFixed(2)} KB/iter (budget ${BUDGET_KB_PER_ITER} KB/iter)`,
                )

                assert.ok(
                    slopeBytesPerIter < BUDGET_KB_PER_ITER * 1024,
                    `Combined pipeline leaks ${(slopeBytesPerIter / 1024).toFixed(1)} KB/iter. ` +
                        `Teardown isn't releasing memory. Atoms: ${atomSamples}, Cache: ${cacheSamples}`,
                )
            }
        },
    )

    // NOTE: a "growth without eviction" sanity-contrast test lived here
    // previously but proved redundant with the molecule-layer `WITHOUT
    // eviction` test AND ran into cross-test pollution with the
    // paginated-store adapter's module-scoped atoms (the contrast
    // iteration's source got stuck because the prior iteration's atom
    // subscriptions were still alive). The load-bearing claim — that with
    // disciplined teardown the combined pipeline keeps memory bounded — is
    // covered above.
})
