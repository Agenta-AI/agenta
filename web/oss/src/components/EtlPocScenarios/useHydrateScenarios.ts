/**
 * useHydrateScenarios
 *
 * Watches the scenario rows IVT has loaded and triggers a bulk hydrate
 * pass per *new* page. Mirrors the ETL PoC's per-chunk hydrate strategy
 * (4 bulk requests per page, all entities populated together) inside a
 * real React + IVT context.
 *
 * Flow per newly-seen scenario set:
 *   1. evaluationResultMolecule.actions.prefetchByScenarioIds  → results
 *   2. evaluationMetricMolecule.actions.prefetchByScenarioIds  → metrics
 *   3. derive testcase_ids from scenarios + results
 *   4. prefetchTestcasesByIds(...)                             → testcases
 *   5. derive trace_ids from results
 *   6. prefetchTracesByIds(...)                                → traces
 *
 * Cache writes go through the molecules' `setQueryData` paths, so cells
 * subscribing via `useQuery({queryKey: cacheKey, enabled: false})` see
 * the data the moment it lands.
 *
 * De-duplication: hydratedScenarioIdsRef tracks IDs already hydrated this
 * mount. New page → only the delta runs through hydrate.
 */

import {useEffect, useMemo, useRef, useState} from "react"

import {evaluationResultMolecule, evaluationMetricMolecule} from "@agenta/entities/evaluationRun"
import {
    predicateToEntitySlices,
    type EntitySlice,
    type RowPredicate,
    type RunSchema,
} from "@agenta/entities/evaluationRun/etl"
import {prefetchTestcasesByIds} from "@agenta/entities/testcase"
import {prefetchTracesByIds} from "@agenta/entities/trace"
import {atom, useSetAtom} from "jotai"

import type {ScenarioThinRow} from "./scenarioPaginatedStore"

const ALL_SLICES: EntitySlice[] = ["results", "metrics", "testcases", "traces"]

/**
 * Hydration-version atom — bumped each time a hydrate batch completes.
 *
 * Cells subscribe to results / metrics caches via `useQuery({enabled: false})`,
 * but testcase + trace caches are read imperatively in the cell's useMemo
 * (the cell doesn't know testcase_id / trace_id until results land). When
 * stage 2 of hydrate (testcases + traces) finishes AFTER the cell's first
 * memo evaluation, the cell never picks up the staged data — its memo deps
 * haven't changed.
 *
 * Fix: bump this atom after every full hydrate batch. Cells subscribe to it
 * via `useAtomValue` so every cell re-renders when stage 2 completes.
 *
 * Cheap: number atom, no payload, single React subscriber tick per batch.
 */
export const hydrationVersionAtom = atom(0)

export interface HydrationProgress {
    /** Total unique scenario IDs hydrated since mount. */
    hydratedScenarios: number
    /** Pages observed (one bulk hydrate pass per page). */
    pagesHydrated: number
    /** Sum of fetchMs across all pages, per entity type. */
    fetchMsByEntity: {
        results: number
        metrics: number
        testcases: number
        traces: number
    }
    /**
     * Which entity slices are being fetched on the next page load,
     * based on the active predicate (or all four when no predicate is
     * active). Surfaced for diagnostics + tests.
     */
    activeSlices: EntitySlice[]
    /** Last error from any prefetch call, or null. */
    lastError: string | null
    /** True while a hydrate pass is mid-flight. */
    isHydrating: boolean
}

const INITIAL_PROGRESS: HydrationProgress = {
    hydratedScenarios: 0,
    pagesHydrated: 0,
    fetchMsByEntity: {results: 0, metrics: 0, testcases: 0, traces: 0},
    activeSlices: ALL_SLICES,
    lastError: null,
    isHydrating: false,
}

/**
 * Slice-fetch strategy for the page-level hydrate.
 *
 * - "auto" (default): page-level hydrate fetches ONLY what's needed
 *   right now. With an active predicate that's the predicate's slice set
 *   (so the filter can run client-side). With NO predicate that's zero
 *   slices — cells materialize their own data on first render via the
 *   cell-side materializer (visible-only, virtualization-aware).
 *
 *   Trade-off: no-predicate first paint shows skeleton cells for a few
 *   hundred ms until the materializer's first batch lands, then fills.
 *   In exchange the network/memory cost matches what the table actually
 *   needs — same shape v2 server-side filtering will land on.
 *
 * - "all": always fetch all 4 slices, regardless of predicate state.
 *   Use for A/B comparison or for workflows that need every column
 *   populated up-front (exports, bulk actions).
 */
export type SliceFetchMode = "auto" | "all"

export interface UseHydrateScenariosArgs {
    projectId: string | null
    runId: string | null
    rows: ScenarioThinRow[]
    /**
     * Run schema — used to map an active predicate's column back to which
     * entity slices need fetching. When omitted (or no predicate set),
     * fetch all four slices to keep the table fully populated for display.
     */
    schema?: RunSchema | null
    /**
     * Active predicate(s). When present and `sliceMode === "auto"`, the
     * hydrate pass only fetches the entity slices required to evaluate
     * them. Skip fetches for slices the predicate doesn't reference —
     * the most common win is dropping the trace fetch (~70% of bytes on
     * typical runs) when the filter is on evaluator outputs only.
     *
     * Cells whose columns weren't pre-hydrated rely on cell-side lazy
     * materialization (see `useCellMaterialization`).
     */
    predicate?: RowPredicate | RowPredicate[] | null
    /**
     * Hydrate strategy — see `SliceFetchMode`. Default "auto".
     */
    sliceMode?: SliceFetchMode
}

export const useHydrateScenarios = ({
    projectId,
    runId,
    rows,
    schema = null,
    predicate = null,
    sliceMode = "auto",
}: UseHydrateScenariosArgs): HydrationProgress => {
    const [progress, setProgress] = useState<HydrationProgress>(INITIAL_PROGRESS)
    const hydratedScenarioIdsRef = useRef<Set<string>>(new Set())
    const inflightRef = useRef<Promise<void> | null>(null)
    const bumpHydrationVersion = useSetAtom(hydrationVersionAtom)

    // Compute the slice set this hydrate pass should fetch.
    //   - sliceMode = "all": always fetch every slice.
    //   - sliceMode = "auto" (default): "pure on-demand" semantics —
    //     - No predicate: 0 slices at page level. Cells fetch what they
    //       need to display, virtualization-aware, via useCellMaterialization.
    //     - Predicate with mapped columns: fetch only the slices the
    //       predicate touches (so the filter can run client-side).
    //       Results are added implicitly when testcases or traces are
    //       needed (those IDs live on result rows).
    //     - Predicate with an unresolvable column: fall back to all 4 —
    //       over-fetch is safer than dropping a predicate silently.
    const activeSlices = useMemo<EntitySlice[]>(() => {
        if (sliceMode === "all") return ALL_SLICES
        const result = predicateToEntitySlices(schema, predicate)
        if (result.fallbackToAll) return ALL_SLICES
        if (result.slices.size === 0) {
            // No predicate active in auto mode → page-level hydrate is a
            // no-op. Cells will materialize what they need on first render.
            return []
        }
        // Always include results when testcases or traces are needed —
        // those IDs live on result rows.
        const slices = new Set<EntitySlice>(result.slices)
        if (slices.has("testcases") || slices.has("traces")) slices.add("results")
        return ALL_SLICES.filter((s) => slices.has(s))
    }, [schema, predicate, sliceMode])

    // Reset bookkeeping when scope OR active slice set changes — different
    // runId means previous scenarios don't apply, and changing the slice
    // mix means we may now need data that previous hydrate passes skipped.
    const activeSlicesKey = activeSlices.join(",")
    useEffect(() => {
        hydratedScenarioIdsRef.current = new Set()
        setProgress({...INITIAL_PROGRESS, activeSlices})
    }, [projectId, runId, activeSlicesKey])

    useEffect(() => {
        if (!projectId || !runId) return
        // Only consider materialized (non-skeleton) scenarios with real IDs.
        //
        // `r.scenarioId` is the API-side scenario UUID. `r.key` is the IVT
        // row identity (`${runId}::${rowKey}` for skeleton-derived rows) —
        // sending that to /results/query would 422 as a malformed UUID.
        const candidateIds = rows
            .filter(
                (r) =>
                    !r.__isSkeleton && typeof r.scenarioId === "string" && r.scenarioId.length > 0,
            )
            .map((r) => r.scenarioId as string)

        const seen = hydratedScenarioIdsRef.current
        const newIds = candidateIds.filter((id) => !seen.has(id))
        if (newIds.length === 0) return

        const slicesToFetch = new Set(activeSlices)
        // Pure on-demand mode: nothing to fetch at the page level. Cells
        // handle their own materialization via useCellMaterialization. Mark
        // these IDs as "seen" so we don't re-enter every render and skip.
        if (slicesToFetch.size === 0) {
            for (const id of newIds) seen.add(id)
            setProgress((p) => ({
                ...p,
                hydratedScenarios: p.hydratedScenarios + newIds.length,
                pagesHydrated: p.pagesHydrated + 1,
                isHydrating: false,
                lastError: null,
            }))
            return
        }

        // Mark optimistically so a re-render mid-flight doesn't queue duplicate
        // prefetch calls for the same scenarios.
        for (const id of newIds) seen.add(id)

        const emptyOutcome = {cacheHits: 0, cacheMisses: 0, fetchMs: 0}

        const hydrateBatch = async () => {
            setProgress((p) => ({...p, isHydrating: true, lastError: null}))
            try {
                // Stage 1 — results + metrics (parallel). Each is fetched
                // only when the active slice set requires it.
                const [resultsOutcome, metricsOutcome] = await Promise.all([
                    slicesToFetch.has("results")
                        ? evaluationResultMolecule.actions.prefetchByScenarioIds({
                              projectId,
                              runId,
                              scenarioIds: newIds,
                          })
                        : Promise.resolve({
                              ...emptyOutcome,
                              results: [],
                              byScenarioId: new Map<string, never>(),
                          }),
                    slicesToFetch.has("metrics")
                        ? evaluationMetricMolecule.actions.prefetchByScenarioIds({
                              projectId,
                              runId,
                              scenarioIds: newIds,
                          })
                        : Promise.resolve({
                              ...emptyOutcome,
                              metrics: [],
                              byScenarioId: new Map<string, never>(),
                          }),
                ])

                // Stage 2 — derive testcase_ids + trace_ids from result rows.
                // Both depend on results, which is why we always fetch
                // results when either testcases or traces is in the slice
                // set (enforced in `activeSlices` above).
                const testcaseIds = new Set<string>()
                if (slicesToFetch.has("testcases")) {
                    // Thin rows don't carry testcase_id — it lives only on
                    // result rows (input step results). We always fetch
                    // results when testcases is in the slice set (enforced
                    // in `activeSlices` above), so this is sufficient.
                    for (const result of resultsOutcome.results) {
                        if (typeof result.testcase_id === "string" && result.testcase_id) {
                            testcaseIds.add(result.testcase_id)
                        }
                    }
                }

                const traceIds = new Set<string>()
                if (slicesToFetch.has("traces")) {
                    for (const result of resultsOutcome.results) {
                        if (typeof result.trace_id === "string" && result.trace_id) {
                            traceIds.add(result.trace_id)
                        }
                    }
                }

                const [testcasesOutcome, tracesOutcome] = await Promise.all([
                    testcaseIds.size > 0
                        ? prefetchTestcasesByIds({
                              projectId,
                              testcaseIds: Array.from(testcaseIds),
                          })
                        : Promise.resolve(emptyOutcome),
                    traceIds.size > 0
                        ? prefetchTracesByIds({
                              projectId,
                              traceIds: Array.from(traceIds),
                          })
                        : Promise.resolve(emptyOutcome),
                ])

                setProgress((p) => ({
                    hydratedScenarios: p.hydratedScenarios + newIds.length,
                    pagesHydrated: p.pagesHydrated + 1,
                    fetchMsByEntity: {
                        results: p.fetchMsByEntity.results + resultsOutcome.fetchMs,
                        metrics: p.fetchMsByEntity.metrics + metricsOutcome.fetchMs,
                        testcases: p.fetchMsByEntity.testcases + testcasesOutcome.fetchMs,
                        traces: p.fetchMsByEntity.traces + tracesOutcome.fetchMs,
                    },
                    activeSlices,
                    lastError: null,
                    isHydrating: false,
                }))
                // Bump after every fully-completed batch so cells whose
                // useMemo deps (results/metrics) finished before stage 2
                // (testcases/traces) landed re-render and pick up the
                // late-arriving cache writes.
                bumpHydrationVersion((v) => v + 1)
            } catch (e) {
                // On failure, un-mark so the next render can retry.
                for (const id of newIds) seen.delete(id)
                setProgress((p) => ({
                    ...p,
                    lastError: e instanceof Error ? e.message : String(e),
                    isHydrating: false,
                }))
            }
        }

        // Serialize hydrate calls — multiple page-loads in quick succession
        // get queued, not parallel. Avoids stampeding the backend.
        inflightRef.current = (inflightRef.current ?? Promise.resolve()).then(hydrateBatch)
    }, [projectId, runId, rows, activeSlicesKey, activeSlices, bumpHydrationVersion])

    return progress
}
