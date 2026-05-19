/**
 * useLookaheadPrefetch — proactive cell-data prefetch on page load.
 *
 * Background: cells materialize their own slices on mount (via the
 * cell-side materializer). That works for visible cells but lags when
 * the user scrolls into a freshly-loaded page — cells mount, request,
 * wait for the fetch to land, then render.
 *
 * This hook closes that gap: when pagination loads a new page (50 new
 * scenarios appear in `pagination.rows`), proactively request all 4
 * entity slices for those scenarios. The materializer dedupes against
 * existing cache and batches concurrent requests, so by the time the
 * user scrolls cells into view their data is already cached.
 *
 * Effective behavior:
 *   visible viewport (page N) ─── cells already materialized
 *   +1 page (page N+1)        ─── data prefetched, cells render instantly
 *   any earlier page          ─── still in cache from when user scrolled past
 *
 * Disabled when sliceMode === "all" — the page-level hydrate already
 * fetched everything, no lookahead needed.
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
