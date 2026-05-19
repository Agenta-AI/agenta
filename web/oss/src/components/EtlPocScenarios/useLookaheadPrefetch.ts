/**
 * useLookaheadPrefetch — proactive cell-data prefetch for the
 * constructed viewport.
 *
 * Background: cells materialize their own slices on mount. That works
 * for visible cells but lags when the user scrolls into freshly-loaded
 * rows — cells mount, request, wait for the fetch to land, then render.
 *
 * Why the input is filteredRows (NOT pagination.rows):
 *
 * With a predicate active, the IVT's "viewport page" is constructed
 * from multiple pagination pages. The viewport-fill loop may load
 * pagination pages 1-10 to accumulate 30 matched rows. Of the 500
 * scenarios in `pagination.rows`, only ~30 will be visible — the
 * other 470 are unmatched and immediately filtered out.
 *
 * Prefetching all 500 would waste ~94% of the work, especially the
 * stage-2 testcase/trace fetches (one round-trip per unmatched row's
 * IDs). Operating on `filteredRows` instead targets only what the
 * user will see.
 *
 *   No predicate:   filteredRows == pagination.rows  → no behavior change
 *   With predicate: filteredRows ⊂ pagination.rows  → prefetch only matched
 *
 * Trade-off: filteredRows includes "pending" rows (passed the filter
 * because their data hasn't loaded yet — see `matchesPredicate`'s
 * keep-visible-until-known fallback). Those may later drop out as
 * predicate slices land and the filter re-evaluates. We'll have
 * prefetched extra data for those — but the predicate-driven page
 * hydrate already fetches the predicate slices for them, so stage 1
 * is net zero extra cost. Stage 2 over-prefetches for "pending →
 * unmatched" rows; acceptable in exchange for not flashing rows
 * in/out of the viewport during predicate evaluation.
 *
 * Two stages, both routed through the materializer (dedup + batching
 * reused for free):
 *   stage 1: rows in filteredRows → request results + metrics
 *   stage 2: on hydrationVersion bump, derive testcase_id / trace_id
 *            from cached results, request those slices
 *
 * Effective behavior:
 *   visible viewport          ─── cells already materialized
 *   constructed +1 page worth ─── data prefetched, cells render instantly
 *   any earlier page          ─── still in cache from when user scrolled past
 *
 * Disabled when sliceMode === "all" — page-level hydrate already
 * fetched everything for every scenario, no lookahead needed.
 */

import {useEffect, useRef} from "react"

import {evaluationResultMolecule} from "@agenta/entities/evaluationRun"
import {useAtomValue} from "jotai"

import type {ScenarioThinRow} from "./scenarioPaginatedStore"
import type {CellMaterializer} from "./useCellMaterialization"
import {hydrationVersionAtom, type SliceFetchMode} from "./useHydrateScenarios"

export interface UseLookaheadPrefetchArgs {
    projectId: string | null
    runId: string | null
    /**
     * IMPORTANT: pass `filteredRows` (post-predicate), NOT `pagination.rows`.
     * The lookahead must target the constructed viewport — see the file
     * header for the full rationale.
     */
    rows: ScenarioThinRow[]
    materializer: CellMaterializer
    /**
     * Disable lookahead when sliceMode === "all" (page-level hydrate
     * already fetched every slice for every page — nothing for the
     * materializer to add).
     */
    sliceMode: SliceFetchMode
}

export const useLookaheadPrefetch = ({
    projectId,
    runId,
    rows,
    materializer,
    sliceMode,
}: UseLookaheadPrefetchArgs): void => {
    // Stage-1 seen set: scenario IDs we've already queued results + metrics for.
    const stage1Ref = useRef<Set<string>>(new Set())
    // Stage-2 seen set: testcase_ids + trace_ids we've already queued.
    // Separate from stage-1 because these IDs come from already-cached
    // results, not from the scenario row directly.
    const stage2TestcaseRef = useRef<Set<string>>(new Set())
    const stage2TraceRef = useRef<Set<string>>(new Set())

    // Subscribe so stage-2 re-runs after each materializer drain — by
    // then more results may have landed in cache, unlocking new
    // testcase_ids / trace_ids.
    const hydrationVersion = useAtomValue(hydrationVersionAtom)

    // Reset when scope changes.
    useEffect(() => {
        stage1Ref.current = new Set()
        stage2TestcaseRef.current = new Set()
        stage2TraceRef.current = new Set()
    }, [projectId, runId])

    // Stage 1: results + metrics for new scenarios.
    useEffect(() => {
        if (!projectId || !runId) return
        if (sliceMode === "all") return
        const seen = stage1Ref.current
        const newScenarioIds: string[] = []
        for (const r of rows) {
            if (r.__isSkeleton) continue
            if (typeof r.scenarioId !== "string" || !r.scenarioId) continue
            if (seen.has(r.scenarioId)) continue
            seen.add(r.scenarioId)
            newScenarioIds.push(r.scenarioId)
        }
        if (newScenarioIds.length === 0) return
        for (const scenarioId of newScenarioIds) {
            materializer.request("results", {scenarioId})
            materializer.request("metrics", {scenarioId})
        }
    }, [projectId, runId, rows, materializer, sliceMode])

    // Stage 2: testcases + traces, derived from cached results. Re-runs
    // each time hydrationVersion bumps (which happens after stage-1
    // results land for new scenarios — the relevant testcase_id /
    // trace_id values now exist in the result cache).
    useEffect(() => {
        if (!projectId || !runId) return
        if (sliceMode === "all") return
        const seenTc = stage2TestcaseRef.current
        const seenTr = stage2TraceRef.current
        for (const r of rows) {
            if (r.__isSkeleton) continue
            if (typeof r.scenarioId !== "string" || !r.scenarioId) continue
            const results =
                evaluationResultMolecule.get.byScenario({
                    projectId,
                    runId,
                    scenarioId: r.scenarioId,
                }) ?? []
            for (const result of results) {
                if (typeof result.testcase_id === "string" && result.testcase_id) {
                    if (!seenTc.has(result.testcase_id)) {
                        seenTc.add(result.testcase_id)
                        materializer.request("testcases", {testcaseId: result.testcase_id})
                    }
                }
                if (typeof result.trace_id === "string" && result.trace_id) {
                    if (!seenTr.has(result.trace_id)) {
                        seenTr.add(result.trace_id)
                        materializer.request("traces", {traceId: result.trace_id})
                    }
                }
            }
        }
    }, [projectId, runId, rows, materializer, sliceMode, hydrationVersion])
}
