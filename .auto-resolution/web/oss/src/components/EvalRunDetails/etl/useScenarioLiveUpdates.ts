/**
 * useScenarioLiveUpdates — keeps the ETL scenarios table fresh while a
 * run is still executing (T6).
 *
 * The ETL table resolves every cell from molecule caches that are
 * populated *once*: `useHydrateScenarios` / `useCellMaterialization`
 * fetch a scenario's results + metrics on first sight and never again.
 * That is correct for a finished run, but a run in progress mutates —
 *
 *   - a scenario's `status` flips  pending → running → success
 *   - its results / metrics only appear once it completes
 *
 * Without a refresh loop a scenario that finishes after the table loaded
 * keeps a stale empty molecule cache (an empty `[]` was cached while it
 * was running) and a stale `running` row status, so its cells show the
 * "Running" indicator forever.
 *
 * While the run is non-terminal this hook, on an interval:
 *
 *   1. Refetches the loaded scenario *pages* — refreshes each row's
 *      `status` so a completed scenario's cells leave the running state.
 *   2. Evicts + re-prefetches the results / metrics molecule caches for
 *      every scenario that is still running, or that finished since the
 *      last tick — replacing the stale empty cache with real values.
 *      (`prefetchByScenarioIds` is cache-aware and would otherwise skip
 *      an already-cached scenario, so the evict is required.)
 *   3. Bumps `hydrationVersionAtom` so cells re-render, re-resolve, and
 *      (via `useCellMaterialization`) pick up freshly-derivable testcase
 *      / trace slices.
 *
 * One final pass runs when the run reaches a terminal status, then the
 * loop stops.
 */

import {useCallback, useEffect, useRef} from "react"

import {evaluationResultMolecule, evaluationMetricMolecule} from "@agenta/entities/evaluationRun"
import {useSetAtom, useStore} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"

import {isTerminalStatus} from "../atoms/compare"
import type {PreviewTableRow} from "../atoms/tableRows"
import {evaluationPreviewTableStore} from "../evaluationPreviewTableStore"

import {hydrationVersionAtom} from "./useHydrateScenarios"

/** Refresh cadence — mirrors the run-status poll in `evaluationRunQueryAtomFamily`. */
const LIVE_REFRESH_INTERVAL_MS = 5000

export interface UseScenarioLiveUpdatesArgs {
    projectId: string | null
    runId: string | null
    /**
     * Latest run-level status. Drives whether the live loop runs — it
     * stops once the run is terminal. `null` (status not loaded yet) is
     * treated as not-live so the loop doesn't start on a blank run.
     */
    runStatus: string | null | undefined
    /** Page size — addresses the base run's page-query atoms. */
    pageSize: number
}

export const useScenarioLiveUpdates = ({
    projectId,
    runId,
    runStatus,
    pageSize,
}: UseScenarioLiveUpdatesArgs): void => {
    const store = useStore()
    const bumpHydrationVersion = useSetAtom(hydrationVersionAtom)
    /** Scenario ids observed non-terminal on the previous tick. */
    const lastNonTerminalRef = useRef<Set<string>>(new Set())
    /** Guard against overlapping ticks if a refresh runs long. */
    const inflightRef = useRef(false)

    const tick = useCallback(async () => {
        if (!projectId || !runId) return
        if (inflightRef.current) return
        inflightRef.current = true
        try {
            // 1. Refetch the loaded scenario pages → refresh row statuses.
            const qc = store.get(queryClientAtom)
            if (qc) {
                await qc.invalidateQueries({
                    queryKey: [evaluationPreviewTableStore.key, runId],
                    exact: false,
                })
            }

            // 2. Read the fresh rows straight from the store — bypasses the
            //    React-state lag so a just-flipped status is seen now.
            const rows = store.get(
                evaluationPreviewTableStore.atoms.combinedRowsAtomFamily({
                    scopeId: runId,
                    pageSize,
                }),
            ) as PreviewTableRow[]

            const loadedIds = new Set<string>()
            const currentNonTerminal = new Set<string>()
            for (const row of rows) {
                if (row.__isSkeleton) continue
                const sid = row.scenarioId
                if (typeof sid !== "string" || !sid) continue
                loadedIds.add(sid)
                if (!isTerminalStatus(row.status)) currentNonTerminal.add(sid)
            }

            // 3. Refresh set: scenarios still running, plus those that
            //    finished since the last tick (their molecule cache still
            //    holds the empty `[]` written while they were running).
            const refreshIds = new Set<string>(currentNonTerminal)
            for (const sid of lastNonTerminalRef.current) {
                if (!currentNonTerminal.has(sid) && loadedIds.has(sid)) {
                    refreshIds.add(sid)
                }
            }
            lastNonTerminalRef.current = currentNonTerminal

            // 4. Evict + re-prefetch the molecule caches for those scenarios.
            if (refreshIds.size > 0) {
                const scenarioIds = Array.from(refreshIds)
                evaluationResultMolecule.actions.evictByScenarioIds({
                    projectId,
                    runId,
                    scenarioIds,
                })
                evaluationMetricMolecule.actions.evictByScenarioIds({
                    projectId,
                    runId,
                    scenarioIds,
                })
                await Promise.all([
                    evaluationResultMolecule.actions.prefetchByScenarioIds({
                        projectId,
                        runId,
                        scenarioIds,
                    }),
                    evaluationMetricMolecule.actions.prefetchByScenarioIds({
                        projectId,
                        runId,
                        scenarioIds,
                    }),
                ])
            }

            // 5. Re-render cells so they re-resolve and (via the cell
            //    materializer) re-derive testcase / trace slices.
            bumpHydrationVersion((v) => v + 1)
        } catch {
            // Transient failure — the next tick retries.
        } finally {
            inflightRef.current = false
        }
    }, [projectId, runId, pageSize, store, bumpHydrationVersion])

    const isLive = !!projectId && !!runId && runStatus != null && !isTerminalStatus(runStatus)

    // Interval refresh while the run is non-terminal.
    useEffect(() => {
        if (!isLive) return
        const id = setInterval(() => void tick(), LIVE_REFRESH_INTERVAL_MS)
        return () => clearInterval(id)
    }, [isLive, tick])

    // One final pass when the run finishes — catches the last batch of
    // scenarios that completed between the previous tick and the run
    // reaching a terminal status.
    const wasLiveRef = useRef(false)
    const flushedRef = useRef(false)
    useEffect(() => {
        if (isLive) {
            wasLiveRef.current = true
            flushedRef.current = false
            return
        }
        if (!wasLiveRef.current || flushedRef.current) return
        flushedRef.current = true
        void tick()
    }, [isLive, tick])
}
