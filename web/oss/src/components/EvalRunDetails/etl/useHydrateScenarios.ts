/**
 * useHydrateScenarios
 *
 * Watches the scenario rows the table has loaded and triggers a bulk
 * hydrate pass per *new* page — bulk requests per page, all entities
 * populated together.
 *
 * Flow per newly-seen scenario set:
 *   1. evaluationResultMolecule.actions.prefetchByScenarioIds  → results
 *   2. evaluationMetricMolecule.actions.prefetchByScenarioIds  → metrics
 *   3. derive testcase_ids from results
 *   4. prefetchTestcasesByIds(...)                             → testcases
 *   5. derive trace_ids from results
 *   6. prefetchTracesByIds(...)                                → traces
 *
 * Cache writes go through the molecules' `setQueryData` paths, so cells
 * subscribing via `useQuery({queryKey: cacheKey, enabled: false})` see
 * the data the moment it lands.
 *
 * Phase 1 note: with no active predicate and `sliceMode === "auto"` the
 * page-level hydrate is intentionally a no-op — cells materialize their
 * own (visible-only) data via `useCellMaterialization`. The hook is wired
 * now so Phase 2 filtering can drive predicate-aware page hydration
 * without a structural change.
 */

import {useEffect, useMemo, useRef, useState} from "react"

import {evaluationResultMolecule, evaluationMetricMolecule} from "@agenta/entities/evaluationRun"
import {
    predicateToEntitySlices,
    type EntitySlice,
    type PredicateGroup,
    type RowPredicate,
    type RunSchema,
} from "@agenta/entities/evaluationRun/etl"
import {prefetchTestcasesByIds} from "@agenta/entities/testcase"
import {prefetchTracesByIds} from "@agenta/entities/trace"
import {atom, useSetAtom} from "jotai"

const ALL_SLICES: EntitySlice[] = ["results", "metrics", "testcases", "traces"]

/**
 * Minimal row shape this hook reads — identity + skeleton flag. Kept
 * structural (fields `unknown`) so it accepts both `PreviewTableRow[]` and
 * the loosely-typed `InfiniteTableRowBase[]` the IVT pagination hook
 * returns, without coupling to either.
 */
export interface HydratableRowRef {
    scenarioId?: unknown
    __isSkeleton?: unknown
}

/**
 * Hydration-version atom — bumped each time a hydrate / materialize batch
 * completes. Cells subscribe to it so they re-render and pick up
 * late-arriving testcase / trace cache writes (whose IDs aren't known
 * until results land). Cheap: number atom, single React tick per batch.
 */
export const hydrationVersionAtom = atom(0)

export interface HydrationProgress {
    /** Total unique scenario IDs hydrated since mount. */
    hydratedScenarios: number
    /** Pages observed (one bulk hydrate pass per page). */
    pagesHydrated: number
    /** Which entity slices the next page load will fetch. */
    activeSlices: EntitySlice[]
    /** Last error from any prefetch call, or null. */
    lastError: string | null
    /** True while a hydrate pass is mid-flight. */
    isHydrating: boolean
}

const INITIAL_PROGRESS: HydrationProgress = {
    hydratedScenarios: 0,
    pagesHydrated: 0,
    activeSlices: ALL_SLICES,
    lastError: null,
    isHydrating: false,
}

/**
 * Slice-fetch strategy for the page-level hydrate.
 *
 * - "auto" (default): fetch only what's needed right now. With an active
 *   predicate that's the predicate's slice set; with no predicate that's
 *   zero slices — cells materialize their own data on first render
 *   (visible-only, virtualization-aware).
 * - "all": always fetch all 4 slices. For workflows that need every
 *   column populated up-front (exports, bulk actions).
 */
export type SliceFetchMode = "auto" | "all"

export interface UseHydrateScenariosArgs {
    projectId: string | null
    runId: string | null
    rows: readonly HydratableRowRef[]
    /** Run schema — maps an active predicate's column to entity slices. */
    schema?: RunSchema | null
    /**
     * Active filter — a single predicate, a predicate array, or a flat
     * AND/OR `PredicateGroup` (Phase 2). When present, page-level hydrate
     * fetches the entity slices the filter needs so it can be evaluated.
     */
    predicate?: RowPredicate | RowPredicate[] | PredicateGroup | null
    /** Hydrate strategy — see `SliceFetchMode`. Default "auto". */
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
    const activeSlices = useMemo<EntitySlice[]>(() => {
        if (sliceMode === "all") return ALL_SLICES
        const result = predicateToEntitySlices(schema, predicate)
        if (result.fallbackToAll) return ALL_SLICES
        if (result.slices.size === 0) {
            // No predicate active in auto mode → page-level hydrate is a
            // no-op. Cells materialize what they need on first render.
            return []
        }
        // Always include results when testcases or traces are needed —
        // those IDs live on result rows.
        const slices = new Set<EntitySlice>(result.slices)
        if (slices.has("testcases") || slices.has("traces")) slices.add("results")
        return ALL_SLICES.filter((s) => slices.has(s))
    }, [schema, predicate, sliceMode])

    const activeSlicesKey = activeSlices.join(",")
    useEffect(() => {
        hydratedScenarioIdsRef.current = new Set()
        setProgress({...INITIAL_PROGRESS, activeSlices})
    }, [projectId, runId, activeSlicesKey])

    useEffect(() => {
        if (!projectId || !runId) return
        // Only consider materialized (non-skeleton) scenarios with real IDs.
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
        // handle their own materialization via useCellMaterialization.
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

        // Mark optimistically so a re-render mid-flight doesn't queue
        // duplicate prefetch calls for the same scenarios.
        for (const id of newIds) seen.add(id)

        const emptyOutcome = {cacheHits: 0, cacheMisses: 0, fetchMs: 0}

        const hydrateBatch = async () => {
            setProgress((p) => ({...p, isHydrating: true, lastError: null}))
            try {
                // Stage 1 — results + metrics (parallel).
                const [resultsOutcome] = await Promise.all([
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
                        : Promise.resolve(null),
                ])

                // Stage 2 — derive testcase_ids + trace_ids from results.
                const testcaseIds = new Set<string>()
                if (slicesToFetch.has("testcases")) {
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

                await Promise.all([
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
                    activeSlices,
                    lastError: null,
                    isHydrating: false,
                }))
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

        // Serialize hydrate calls — multiple page-loads in quick
        // succession get queued, not parallel.
        inflightRef.current = (inflightRef.current ?? Promise.resolve()).then(hydrateBatch)
    }, [projectId, runId, rows, activeSlicesKey, activeSlices, bumpHydrationVersion])

    return progress
}
