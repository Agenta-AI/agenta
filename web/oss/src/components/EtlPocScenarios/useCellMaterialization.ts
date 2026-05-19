/**
 * useCellMaterialization — lazy, batched cell-side prefetch.
 *
 * The page-level `useHydrateScenarios` only fetches entity slices the
 * active predicate touches (filter-driven). Visible cells whose column
 * lives in a non-fetched slice need to materialize themselves.
 *
 * If 30 visible cells each call `molecule.actions.prefetchByScenarioIds(
 * [scenarioId])` independently, the backend gets 30 round trips. To
 * avoid that, this hook coalesces same-tick requests:
 *
 *   1. Cell asks for `(slice, scenarioId)` on first render.
 *   2. Request is queued in a per-slice ref-set.
 *   3. After a microtask flush, the hook drains every per-slice queue
 *      and issues ONE bulk prefetch call per slice with all requested IDs.
 *   4. Cells re-render via `hydrationVersionAtom` once the writes land.
 *
 * Concurrent batches deduplicate via the same in-flight tracking set
 * that the page-level hydrate uses; no scenario fires twice.
 */

import {useEffect, useRef} from "react"

import {evaluationResultMolecule, evaluationMetricMolecule} from "@agenta/entities/evaluationRun"
import type {EntitySlice} from "@agenta/entities/evaluationRun/etl"
import {testcaseMolecule} from "@agenta/entities/testcase"
import {traceSpanMolecule} from "@agenta/entities/trace"
import {useSetAtom} from "jotai"

import {hydrationVersionAtom} from "./useHydrateScenarios"

interface MaterializeRequest {
    /** scenarioId — required for results / metrics. */
    scenarioId?: string
    /** testcase_id — required for testcases. */
    testcaseId?: string
    /** trace_id — required for traces. */
    traceId?: string
}

interface BatchState {
    /** Queued requests per slice. Drained on next microtask. */
    queues: Record<EntitySlice, MaterializeRequest[]>
    /** Per-slice "currently fetching IDs" so we don't double-fire. */
    inflightIds: Record<EntitySlice, Set<string>>
    /** True if a drain is already scheduled this tick. */
    scheduled: boolean
}

const initialBatchState = (): BatchState => ({
    queues: {results: [], metrics: [], testcases: [], traces: []},
    inflightIds: {
        results: new Set(),
        metrics: new Set(),
        testcases: new Set(),
        traces: new Set(),
    },
    scheduled: false,
})

interface UseCellMaterializationArgs {
    projectId: string | null
    runId: string | null
}

export interface CellMaterializer {
    /**
     * Request materialization of (slice, identifier). The hook coalesces
     * concurrent requests on the same microtask into one bulk fetch per
     * slice. Safe to call repeatedly from a cell's render — duplicates
     * are deduped.
     */
    request: (slice: EntitySlice, req: MaterializeRequest) => void
}

export const useCellMaterialization = ({
    projectId,
    runId,
}: UseCellMaterializationArgs): CellMaterializer => {
    const stateRef = useRef<BatchState>(initialBatchState())
    const bumpHydrationVersion = useSetAtom(hydrationVersionAtom)

    useEffect(() => {
        // Reset on scope change.
        stateRef.current = initialBatchState()
    }, [projectId, runId])

    const drain = async () => {
        const state = stateRef.current
        state.scheduled = false
        if (!projectId || !runId) return

        // Snapshot + reset the queues — new requests can queue while
        // we're fetching, those will trigger their own drain.
        const queues = state.queues
        state.queues = {results: [], metrics: [], testcases: [], traces: []}

        // Dedup IDs per slice + filter against in-flight set.
        const scenarioIdsForResults = collectUnique(
            queues.results,
            "scenarioId",
            state.inflightIds.results,
        )
        const scenarioIdsForMetrics = collectUnique(
            queues.metrics,
            "scenarioId",
            state.inflightIds.metrics,
        )
        const testcaseIds = collectUnique(
            queues.testcases,
            "testcaseId",
            state.inflightIds.testcases,
        )
        const traceIds = collectUnique(queues.traces, "traceId", state.inflightIds.traces)

        try {
            await Promise.all([
                scenarioIdsForResults.length > 0
                    ? evaluationResultMolecule.actions
                          .prefetchByScenarioIds({
                              projectId,
                              runId,
                              scenarioIds: scenarioIdsForResults,
                          })
                          .finally(() => {
                              for (const id of scenarioIdsForResults)
                                  state.inflightIds.results.delete(id)
                          })
                    : Promise.resolve(),
                scenarioIdsForMetrics.length > 0
                    ? evaluationMetricMolecule.actions
                          .prefetchByScenarioIds({
                              projectId,
                              runId,
                              scenarioIds: scenarioIdsForMetrics,
                          })
                          .finally(() => {
                              for (const id of scenarioIdsForMetrics)
                                  state.inflightIds.metrics.delete(id)
                          })
                    : Promise.resolve(),
                testcaseIds.length > 0
                    ? testcaseMolecule.actions
                          .prefetchByIds({projectId, testcaseIds})
                          .finally(() => {
                              for (const id of testcaseIds) state.inflightIds.testcases.delete(id)
                          })
                    : Promise.resolve(),
                traceIds.length > 0
                    ? traceSpanMolecule.actions.prefetchByIds({projectId, traceIds}).finally(() => {
                          for (const id of traceIds) state.inflightIds.traces.delete(id)
                      })
                    : Promise.resolve(),
            ])

            // Bump the hydration version so cells re-render and pick up
            // their newly-cached data.
            if (
                scenarioIdsForResults.length +
                    scenarioIdsForMetrics.length +
                    testcaseIds.length +
                    traceIds.length >
                0
            ) {
                bumpHydrationVersion((v) => v + 1)
            }
        } catch (e) {
            // Swallow — cells will still show "—" and the next visible
            // render will retry. Log so it's visible in console during
            // development.
            console.warn("[useCellMaterialization] batch failed:", e)
        }
    }

    const request: CellMaterializer["request"] = (slice, req) => {
        const state = stateRef.current
        const id =
            slice === "testcases"
                ? req.testcaseId
                : slice === "traces"
                  ? req.traceId
                  : req.scenarioId
        if (!id) return
        if (state.inflightIds[slice].has(id)) return
        // Mark as in-flight optimistically so other cells don't re-queue
        // before the drain fires.
        state.inflightIds[slice].add(id)
        state.queues[slice].push(req)
        if (!state.scheduled) {
            state.scheduled = true
            queueMicrotask(drain)
        }
    }

    return {request}
}

function collectUnique(
    requests: MaterializeRequest[],
    field: keyof MaterializeRequest,
    inflight: Set<string>,
): string[] {
    const out = new Set<string>()
    for (const r of requests) {
        const v = r[field]
        if (typeof v !== "string" || !v) continue
        if (inflight.has(v)) {
            // already in flight — strip from queue (the requesting cell
            // will re-render via hydrationVersionAtom when it lands).
            continue
        }
        out.add(v)
    }
    return Array.from(out)
}
