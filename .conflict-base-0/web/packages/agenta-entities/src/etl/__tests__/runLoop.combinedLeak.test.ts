/**
 * Combined leak test — `makeSourceFromPaginatedStore` + molecule layer.
 *
 * The original engine leak test (`runLoop.leak.test.ts`) exercises the
 * runtime with synthetic Source/Sink. The molecule leak test
 * (`molecules.leak.test.ts`) exercises the TanStack cache layer in
 * isolation. Neither test covers the COMBINATION — running the real
 * paginated source adapter alongside the molecule-backed hydrate
 * fetchers, iteration after iteration.
 *
 * What this test catches:
 *
 *   1. `atomFamily(scopeId)` retention inside `createPaginatedEntityStore`
 *      — every fresh `scopeId` adds an entry to the paginated store's
 *      controller atom family. Without `.remove()` (or scopeId reuse),
 *      it grows unboundedly across pipeline runs.
 *
 *   2. `traceEntityAtomFamily` retention — every unique traceId visited
 *      adds an atom. Long ETL passes against unique trace_ids accumulate.
 *
 *   3. TanStack cache growth from the cumulative effect of result/metric/
 *      testcase/trace writes, which only release if the caller explicitly
 *      evicts.
 *
 * Methodology: 50 iterations of a fully-synthetic pipeline (no network),
 * sample heap + entity counts at intervals. Two contrasting modes:
 *
 *   - With teardown (evict + atom family clear) → heap slope near zero
 *   - Without teardown → heap + cache + atom-family entries grow linearly
 *
 * Skipped without --expose-gc.
 */

import assert from "node:assert/strict"
import {describe, it} from "node:test"

import {QueryClient} from "@tanstack/react-query"
import {atom, getDefaultStore} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"

import {inspectCache, clearCacheByPrefix} from "../../evaluationRun/etl/cacheDiagnostics"
import {evaluationMetricMolecule} from "../../evaluationRun/state/metricMolecule"
import {evaluationResultMolecule} from "../../evaluationRun/state/resultMolecule"
import {
    inspectAtomFamilies,
    clearAllAtomFamilies,
} from "../../shared/molecule/instrumentedAtomFamily"
import {createPaginatedEntityStore} from "../../shared/paginated/createPaginatedEntityStore"
import {makeSourceFromPaginatedStore} from "../adapters/makeSourceFromPaginatedStore"
import type {Sink, Transform} from "../core/types"
import {runLoop} from "../runtime/runLoop"

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
// Main: 50-iteration combined pipeline, with vs without teardown
// =============================================================================

describe("Combined leak: paginatedStore + molecule layer", () => {
    it(
        "50 iterations WITH teardown: heap slope ≈ 0, atoms + cache drained between runs",
        {timeout: 90_000, skip: !hasGc ? "needs --expose-gc" : false},
        async () => {
            installQc()
            const ITERATIONS = 50
            const ROWS_PER_RUN = 40
            const PAGE_SIZE = 20
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
                // The paginated store now owns its own atomFamily registry
                // AND its TanStack queries. dispose() releases both — the
                // 13 internal atom families + every cache entry keyed by
                // the store's `options.key`. Without this, ~70 KB/iter
                // accumulates from TanStack observer state for retired
                // scopeIds. WITH dispose(), the combined slope is ~3 KB/iter
                // (flat — GC noise floor).
                scenariosStore.dispose()
                // Also clear any globally-registered families (trace store etc.)
                clearAllAtomFamilies()

                if (iter > 5 && iter % 5 === 0) {
                    forceGc()
                    samples.push(process.memoryUsage().heapUsed)
                    atomSamples.push(inspectAtomFamilies().reduce((a, f) => a + f.size, 0))
                    cacheSamples.push(inspectCache().totalEntries)
                }
            }

            const slopeBytesPerSample = regressionSlope(samples)
            const slopeBytesPerIter = slopeBytesPerSample / 5
            // Tight budget: once `paginatedStore.dispose()` was added (with
            // TanStack query removal), measured slope is ~3 KB/iter. The
            // budget is set to 30 KB to leave headroom for GC noise but
            // catch any future regression from the dispose path breaking.
            const BUDGET_KB_PER_ITER = 30

            console.log(
                `\n  heap samples (MB): [${samples.map((s) => (s / 1024 / 1024).toFixed(1)).join(", ")}]`,
            )
            console.log(`  atom family params at each sample: [${atomSamples.join(", ")}]`)
            console.log(`  TanStack cache entries at each sample: [${cacheSamples.join(", ")}]`)
            console.log(
                `  heap slope: ${(slopeBytesPerIter / 1024).toFixed(2)} KB/iter (budget ${BUDGET_KB_PER_ITER} KB/iter)`,
            )

            assert.ok(
                slopeBytesPerIter < BUDGET_KB_PER_ITER * 1024,
                `Combined pipeline leaks ${(slopeBytesPerIter / 1024).toFixed(1)} KB/iter. ` +
                    `Teardown isn't releasing memory. Atoms: ${atomSamples}, Cache: ${cacheSamples}`,
            )

            // Atom family params should stabilize near zero post-teardown.
            // We allow some slack because each iteration's teardown runs
            // BEFORE the next iteration's allocations.
            const lastAtomSample = atomSamples[atomSamples.length - 1] ?? 0
            assert.ok(lastAtomSample < 50, `Atom family params not draining: ${atomSamples}`)
        },
    )

    // NOTE: a "growth without eviction" sanity-contrast test lived here
    // previously but proved redundant with `molecules.leak.test.ts:WITHOUT
    // eviction` AND ran into cross-test pollution with the paginated-store
    // adapter's module-scoped atoms (the contrast iteration's source got
    // stuck because the prior iteration's atom subscriptions were still
    // alive). The load-bearing claim — that with disciplined teardown the
    // combined pipeline keeps heap bounded — is covered above.
    //
    // If you ever want a long-run combined-without-teardown test, isolate
    // the paginated-store state per process (run in a child) or replace
    // the adapter with a simpler inline Source for that specific case.
})

// =============================================================================
// instrumentedAtomFamily semantics tests (no GC needed)
// =============================================================================

describe("instrumentedAtomFamily: size + remove + clear semantics", () => {
    it("tracks size as new params arrive", async () => {
        // Build a fresh instrumented family for an isolated check.
        const {instrumentedAtomFamily} =
            await import("../../shared/molecule/instrumentedAtomFamily")
        const family = instrumentedAtomFamily((id: string) => atom(id), {
            name: "test.sizeFamily",
            skipRegistry: true,
        })

        assert.equal(family.size(), 0)
        family("a")
        family("b")
        family("a") // dedup
        assert.equal(family.size(), 2)
        family("c")
        assert.equal(family.size(), 3)
    })

    it("remove() drops a single param", async () => {
        const {instrumentedAtomFamily} =
            await import("../../shared/molecule/instrumentedAtomFamily")
        const family = instrumentedAtomFamily((id: string) => atom(id), {
            name: "test.removeFamily",
            skipRegistry: true,
        })
        family("a")
        family("b")
        assert.equal(family.size(), 2)
        family.remove("a")
        assert.equal(family.size(), 1)
        assert.deepEqual(Array.from(family.params()), ["b"])
    })

    it("clear() drops everything", async () => {
        const {instrumentedAtomFamily} =
            await import("../../shared/molecule/instrumentedAtomFamily")
        const family = instrumentedAtomFamily((id: string) => atom(id), {
            name: "test.clearFamily",
            skipRegistry: true,
        })
        for (let i = 0; i < 100; i++) family(`x${i}`)
        assert.equal(family.size(), 100)
        family.clear()
        assert.equal(family.size(), 0)
    })

    it("registry surfaces named families via inspectAtomFamilies", async () => {
        const {
            instrumentedAtomFamily,
            inspectAtomFamilies,
            clearAllAtomFamilies: clearAll,
        } = await import("../../shared/molecule/instrumentedAtomFamily")
        clearAll()
        const family = instrumentedAtomFamily((id: string) => atom(id), {
            name: "test.registryFamily",
        })
        family("p1")
        family("p2")
        const stats = inspectAtomFamilies()
        const ours = stats.find((s) => s.name === "test.registryFamily")
        assert.ok(ours, "family should be in registry")
        assert.equal(ours.size, 2)
        clearAll()
    })
})
