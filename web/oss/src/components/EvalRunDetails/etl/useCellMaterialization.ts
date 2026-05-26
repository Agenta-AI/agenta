/**
 * useCellMaterialization — lazy, batched, run-aware cell-side prefetch.
 *
 * The page-level `useHydrateScenarios` only fetches entity slices the
 * active predicate touches (Phase 2). In Phase 1 (no predicate) it fetches
 * nothing, so every visible cell materializes itself.
 *
 * If 30 visible cells each call `molecule.actions.prefetchByScenarioIds(
 * [scenarioId])` independently, the backend gets 30 round trips. To avoid
 * that, this hook coalesces same-tick requests:
 *
 *   1. Cell asks for `(slice, {scenarioId, runId})` on first render.
 *   2. Request is queued in a per-slice ref-set.
 *   3. After a microtask flush, the hook drains every per-slice queue and
 *      issues ONE bulk prefetch per (slice, runId) with all requested IDs.
 *   4. Cells re-render via `hydrationVersionAtom` once the writes land.
 *
 * Run-aware: results / metrics caches are run-scoped, so the queue is
 * grouped by `runId` and one prefetch is issued per run. This is what
 * lets comparison rows (which carry a different `runId` than the base
 * run) hydrate correctly.
 */

import {useEffect, useRef} from "react"

import {evaluationResultMolecule, evaluationMetricMolecule} from "@agenta/entities/evaluationRun"
import type {EntitySlice} from "@agenta/entities/evaluationRun/etl"
import {testcaseMolecule} from "@agenta/entities/testcase"
import {traceSpanMolecule} from "@agenta/entities/trace"
import {getDefaultStore, useSetAtom} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"

import {hydrationVersionAtom} from "./useHydrateScenarios"

interface MaterializeRequest {
    /** scenarioId — required for results / metrics. */
    scenarioId?: string
    /** runId — required for results / metrics (run-scoped caches). */
    runId?: string
    /** testcase_id — required for testcases. */
    testcaseId?: string
    /** trace_id — required for traces. */
    traceId?: string
}

interface BatchState {
    /** Queued requests per slice. Drained on next microtask. */
    queues: Record<EntitySlice, MaterializeRequest[]>
    /** Per-slice "currently fetching" tracking keys so we don't double-fire. */
    inflightKeys: Record<EntitySlice, Set<string>>
    /**
     * Per-slice "tried and got nothing back" tracking keys. The most
     * common cause is HTTP 429 rate-limiting — the molecule's prefetch
     * swallows the error and returns empty, leaving the cache empty.
     * Without this set, the cell rerenders forever in a tight retry loop.
     * Marked permanently for the session — user reloads to retry.
     */
    failedKeys: Record<EntitySlice, Set<string>>
    /** True if a drain is already scheduled this tick. */
    scheduled: boolean
}

const initialBatchState = (): BatchState => ({
    queues: {results: [], metrics: [], testcases: [], traces: []},
    inflightKeys: {
        results: new Set(),
        metrics: new Set(),
        testcases: new Set(),
        traces: new Set(),
    },
    failedKeys: {
        results: new Set(),
        metrics: new Set(),
        testcases: new Set(),
        traces: new Set(),
    },
    scheduled: false,
})

/**
 * Stable tracking key for a (slice, request) pair. Results / metrics are
 * run-scoped so the key includes `runId`; testcases / traces are keyed by
 * their own id. Returns null when the request lacks the fields the slice
 * needs.
 */
const trackingKey = (slice: EntitySlice, req: MaterializeRequest): string | null => {
    if (slice === "results" || slice === "metrics") {
        if (!req.runId || !req.scenarioId) return null
        return `${req.runId}::${req.scenarioId}`
    }
    if (slice === "testcases") return req.testcaseId ?? null
    if (slice === "traces") return req.traceId ?? null
    return null
}

interface UseCellMaterializationArgs {
    projectId: string | null
    /** Page (base) run id — used only to reset state on scope change. */
    runId: string | null
}

export interface CellMaterializer {
    /**
     * Request materialization of (slice, request). The hook coalesces
     * concurrent requests on the same microtask into one bulk fetch per
     * (slice, runId). Safe to call repeatedly from a cell's render —
     * duplicates are deduped.
     */
    request: (slice: EntitySlice, req: MaterializeRequest) => void
    /**
     * True when a prior fetch for (slice, request) settled without
     * populating the cache — most often a 429. Lets a cell stop showing a
     * skeleton for a slice that will never arrive this session.
     */
    hasFailed: (slice: EntitySlice, req: MaterializeRequest) => boolean
}

const groupScenariosByRun = (reqs: MaterializeRequest[]): Map<string, string[]> => {
    const out = new Map<string, string[]>()
    for (const r of reqs) {
        if (!r.runId || !r.scenarioId) continue
        const arr = out.get(r.runId) ?? []
        if (!arr.includes(r.scenarioId)) arr.push(r.scenarioId)
        out.set(r.runId, arr)
    }
    return out
}

const dedupField = (reqs: MaterializeRequest[], field: "testcaseId" | "traceId"): string[] => {
    const out = new Set<string>()
    for (const r of reqs) {
        const v = r[field]
        if (typeof v === "string" && v) out.add(v)
    }
    return Array.from(out)
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
        if (!projectId) return

        // Snapshot + reset the queues — new requests can queue while
        // we're fetching, those trigger their own drain.
        const queues = state.queues
        state.queues = {results: [], metrics: [], testcases: [], traces: []}

        const resultsByRun = groupScenariosByRun(queues.results)
        const metricsByRun = groupScenariosByRun(queues.metrics)
        const testcaseIds = dedupField(queues.testcases, "testcaseId")
        const traceIds = dedupField(queues.traces, "traceId")

        // Mark in-flight before starting fetch so subsequent ticks dedupe.
        for (const [run, ids] of resultsByRun) {
            for (const id of ids) state.inflightKeys.results.add(`${run}::${id}`)
        }
        for (const [run, ids] of metricsByRun) {
            for (const id of ids) state.inflightKeys.metrics.add(`${run}::${id}`)
        }
        for (const id of testcaseIds) state.inflightKeys.testcases.add(id)
        for (const id of traceIds) state.inflightKeys.traces.add(id)

        const qc = getDefaultStore().get(queryClientAtom)

        // After a fetch settles, for each requested id check whether the
        // cache now holds data. If not, the fetch failed silently (most
        // often a 429) — mark it failed so request() skips it on future
        // renders, avoiding an infinite request → 429 → retry loop.
        const markRunFailures = (
            slice: "results" | "metrics",
            run: string,
            scenarioIds: string[],
        ) => {
            if (!qc) return
            const prefix = slice === "results" ? "evaluation-results" : "evaluation-metrics"
            for (const id of scenarioIds) {
                const tk = `${run}::${id}`
                state.inflightKeys[slice].delete(tk)
                const cached = qc.getQueryData([prefix, projectId, run, id])
                if (cached === undefined) state.failedKeys[slice].add(tk)
            }
        }
        const markIdFailures = (slice: "testcases" | "traces", ids: string[]) => {
            if (!qc) return
            const prefix = slice === "testcases" ? "testcase" : "trace-entity"
            for (const id of ids) {
                state.inflightKeys[slice].delete(id)
                const cached = qc.getQueryData([prefix, projectId, id])
                if (cached === undefined) state.failedKeys[slice].add(id)
            }
        }

        const tasks: Promise<unknown>[] = []
        for (const [run, scenarioIds] of resultsByRun) {
            tasks.push(
                evaluationResultMolecule.actions
                    .prefetchByScenarioIds({projectId, runId: run, scenarioIds})
                    .finally(() => markRunFailures("results", run, scenarioIds)),
            )
        }
        for (const [run, scenarioIds] of metricsByRun) {
            tasks.push(
                evaluationMetricMolecule.actions
                    .prefetchByScenarioIds({projectId, runId: run, scenarioIds})
                    .finally(() => markRunFailures("metrics", run, scenarioIds)),
            )
        }
        if (testcaseIds.length > 0) {
            tasks.push(
                testcaseMolecule.actions
                    .prefetchByIds({projectId, testcaseIds})
                    .finally(() => markIdFailures("testcases", testcaseIds)),
            )
        }
        if (traceIds.length > 0) {
            tasks.push(
                traceSpanMolecule.actions
                    .prefetchByIds({projectId, traceIds})
                    .finally(() => markIdFailures("traces", traceIds)),
            )
        }

        try {
            await Promise.all(tasks)
            // Bump so cells re-render and pick up their newly-cached data.
            if (tasks.length > 0) bumpHydrationVersion((v) => v + 1)
        } catch (e) {
            console.warn("[useCellMaterialization] batch failed:", e)
        }
    }

    const request: CellMaterializer["request"] = (slice, req) => {
        const state = stateRef.current
        const tk = trackingKey(slice, req)
        if (!tk) return
        // Skip if a previous drain for this key failed (most often a 429).
        if (state.failedKeys[slice].has(tk)) return
        // Skip if already being fetched by an earlier batch.
        if (state.inflightKeys[slice].has(tk)) return
        // Skip if a sibling cell already queued the same key this tick.
        if (state.queues[slice].some((r) => trackingKey(slice, r) === tk)) return
        state.queues[slice].push(req)
        if (!state.scheduled) {
            state.scheduled = true
            queueMicrotask(drain)
        }
    }

    const hasFailed: CellMaterializer["hasFailed"] = (slice, req) => {
        const tk = trackingKey(slice, req)
        if (!tk) return false
        return stateRef.current.failedKeys[slice].has(tk)
    }

    return {request, hasFailed}
}
