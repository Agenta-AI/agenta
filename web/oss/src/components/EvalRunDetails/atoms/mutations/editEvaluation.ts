/**
 * Edit-evaluation mutation (jotai mutation pattern).
 *
 * Low-level `atomWithMutation` atoms wrap the run-shape API fns; the orchestrating
 * write-atom `saveEvaluationEditAtom` applies the drawer's staged changes
 * (name/description + newly-added evaluators) and refreshes the affected surfaces.
 * Components call `useSetAtom(saveEvaluationEditAtom)` — they never touch Fern.
 *
 * Flow:
 *   edit(name, description, evaluator_steps = existing + added)  → server rebuilds
 *     name/description + steps + mappings (existing steps keep keys, cells survive)
 *   process(scenario_ids, overwrite:false)  → fills only added evaluators' cells
 *     (skipped when nothing was added)
 *   invalidate(batcher cache + run + scenarios + metrics + list summary) → both
 *     tables refresh columns AND rows; results pollers then fill cells.
 */
import {atom} from "jotai"
import {atomWithMutation, queryClientAtom} from "jotai-tanstack-query"

import {clearMetricSelectionCache} from "@/oss/components/EvaluationRunsTablePOC/hooks/useRunMetricSelection"
import {
    getPreviewRunBatcher,
    invalidatePreviewRunCache,
} from "@/oss/lib/hooks/usePreviewEvaluations/assets/previewRunBatcher"
import {clearPreviewRunsCache} from "@/oss/lib/hooks/usePreviewEvaluations/assets/previewRunsRequest"
import {
    editEvaluationRunShape,
    processEvaluationRunSlice,
    queryRunScenarioIds,
    type EvaluatorOrigin,
} from "@/oss/services/evaluations/runShape/api"
import {projectIdAtom} from "@/oss/state/project/selectors/project"

import {isTerminalStatus} from "../compare"
import {invalidateScenarioStepsBatcherCache} from "../scenarioSteps"
import {evaluationRunQueryAtomFamily} from "../table/run"

interface RunStep {
    type?: string
    origin?: string
    references?: Record<string, {id?: string} | null | undefined> | null
}

const stepsOf = (run: any): RunStep[] => (Array.isArray(run?.data?.steps) ? run.data.steps : [])

const revisionIds = (steps: RunStep[], type: string, refKey: string): string[] =>
    steps
        .filter((step) => step?.type === type && step?.references?.[refKey]?.id)
        .map((step) => step.references![refKey]!.id as string)

/**
 * Build `{revisionId: origin}` preserving each existing step's origin. The server's
 * `_make_evaluation_run_data` defaults a bare id LIST to origin="custom"
 * (DEFAULT_ORIGIN_* in service.py), which would flip an "auto" run to "SDK"/custom in the
 * kind derivation. Sending the run's real origins keeps the edit shape-preserving.
 */
const revisionOrigins = (
    steps: RunStep[],
    type: string,
    refKey: string,
): Record<string, EvaluatorOrigin> => {
    const out: Record<string, EvaluatorOrigin> = {}
    for (const step of steps) {
        if (step?.type !== type) continue
        const id = step.references?.[refKey]?.id
        if (!id) continue
        out[id] = (step.origin as EvaluatorOrigin) ?? "auto"
    }
    return out
}

export const editRunShapeMutationAtom = atomWithMutation(() => ({
    mutationFn: editEvaluationRunShape,
}))

export const processRunSliceMutationAtom = atomWithMutation(() => ({
    mutationFn: processEvaluationRunSlice,
}))

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Matches every react-query key that drives a surface affected by an edit/reprocess. Rather
 * than enumerate roots (which silently misses some — e.g. the `["eval-table","scenarios",…]`
 * rows+status query, or annotation/testcase roots), match ANY key scoped to this run id.
 * That makes the post-edit refresh reload-equivalent: run shape (columns), scenario rows +
 * status, per-scenario steps (cells), metric/stats, summary. The evaluations LIST root is
 * keyed by project (not run), so include it explicitly.
 */
const isRunSurfaceKey = (key: unknown, runId: string): boolean => {
    if (!Array.isArray(key)) return false
    if (key[0] === "evaluation-runs-table") return true
    return key.includes(runId)
}

const clearRunSideCaches = (projectId: string, runId: string) => {
    invalidatePreviewRunCache(projectId, runId)
    clearPreviewRunsCache()
    // The list metric cells read an in-memory selection cache layered over the
    // run-metric-stats query; clear it so refreshed stats aren't masked by a stale entry.
    clearMetricSelectionCache()
    // The scenario-steps batcher dedupes in-flight requests; reset it so a request that
    // started before the edit can't serve pre-edit steps to a post-edit caller.
    invalidateScenarioStepsBatcherCache()
}

/** Refetch ACTIVE run surfaces (mounted rows) — cheap, used during the reprocess poll. */
const refetchRunSurfaces = async (queryClient: any, projectId: string, runId: string) => {
    clearRunSideCaches(projectId, runId)
    await queryClient.refetchQueries({
        predicate: (query: {queryKey: unknown}) => isRunSurfaceKey(query.queryKey, runId),
    })
}

/**
 * Invalidate ALL run surfaces — marks inactive/virtualized scenario rows stale (so they
 * refetch fresh when next scrolled into view), not just the currently-mounted ones, and
 * refetches the active ones. Used for the final pass once the reprocess is done.
 */
const invalidateRunSurfaces = async (queryClient: any, projectId: string, runId: string) => {
    clearRunSideCaches(projectId, runId)
    await queryClient.invalidateQueries({
        predicate: (query: {queryKey: unknown}) => isRunSurfaceKey(query.queryKey, runId),
    })
}

/**
 * Authoritative run status, read straight from the run batcher (bypasses react-query
 * active-state / refetch timing). Used to detect when the worker has finished so the final
 * invalidation lands reliably.
 */
const readRunStatusAuthoritative = async (
    projectId: string,
    runId: string,
): Promise<string | null> => {
    invalidatePreviewRunCache(projectId, runId)
    try {
        const raw = (await getPreviewRunBatcher()({projectId, runId})) as
            | {status?: unknown}
            | null
            | undefined
        const status = raw?.status
        if (!status) return null
        return typeof status === "string" ? status : ((status as {value?: string}).value ?? null)
    } catch {
        return null
    }
}

const BRIDGE_ATTEMPTS = 15
const BRIDGE_INTERVAL_MS = 2000

/**
 * Bridge the async reprocess after adding an evaluator.
 *
 * `dispatch_run_slice` flips the run to RUNNING *synchronously* before the 202 returns
 * (api/.../service.py), then the worker fills the new evaluator's cells and finalizes back
 * to a terminal status (~seconds). So by the time this runs the run is already RUNNING;
 * we poll every surface until the run reads TERMINAL again — which means the worker is done
 * and every new cell is persisted — then run a FINAL invalidation.
 *
 * The final terminal-gated invalidation is the key to a reliable scenario table. The
 * per-scenario `scenario-steps` queries only poll while non-terminal (scenarioSteps.ts
 * `refetchInterval`), so when finalize lands between their 5s polls, only the rows that
 * happened to refetch afterwards show new data — a half-updated table. Invalidating once
 * the run is terminal converges every mounted row and marks off-screen/virtualized rows
 * stale for their next mount. Fire-and-forget: the drawer closes immediately.
 */
const SETTLE_MS = 1500

const bridgeRunReprocessing = async (queryClient: any, projectId: string, runId: string) => {
    for (let attempt = 0; attempt < BRIDGE_ATTEMPTS; attempt++) {
        await delay(BRIDGE_INTERVAL_MS)
        const status = await readRunStatusAuthoritative(projectId, runId)
        if (status && isTerminalStatus(status)) {
            // Worker finished. Cell results can persist a beat after the run status flips
            // terminal, so invalidate now AND once more after a short settle. Each call
            // refetches active scenario rows/steps/metrics and marks off-screen ones stale —
            // reload-equivalent, so nothing is left frozen by the per-scenario poller that
            // stops the instant the run goes terminal.
            await invalidateRunSurfaces(queryClient, projectId, runId)
            await delay(SETTLE_MS)
            await invalidateRunSurfaces(queryClient, projectId, runId)
            return
        }
        // Still running — refresh active surfaces so progress (RUNNING status, cells) streams in.
        await refetchRunSurfaces(queryClient, projectId, runId)
    }
    // Budget exhausted (very long reprocess, or status unreadable). Final invalidation so
    // nothing is left half-updated.
    await invalidateRunSurfaces(queryClient, projectId, runId)
}

export interface SaveEvaluationEditArgs {
    runId: string
    /** Current name (seeded from the run; sent even if unchanged — edit replaces it). */
    name: string
    /** Current description (sent even if unchanged). */
    description: string
    /** Evaluator REVISION ids staged for addition in the drawer. */
    addedEvaluatorRevisionIds: string[]
}

export const saveEvaluationEditAtom = atom(
    null,
    async (
        get,
        _set,
        {runId, name, description, addedEvaluatorRevisionIds}: SaveEvaluationEditArgs,
    ) => {
        if (!runId) return

        const projectId = get(projectIdAtom)
        if (!projectId) throw new Error("[edit-evaluation] missing projectId")

        const run = get(evaluationRunQueryAtomFamily(runId))?.data?.rawRun
        if (!run) throw new Error("[edit-evaluation] run not loaded")

        const steps = stepsOf(run)
        const annotationSteps = steps.filter((step) => step?.type === "annotation")
        const existingEvaluatorIds = revisionIds(steps, "annotation", "evaluator_revision")
        const fresh = (addedEvaluatorRevisionIds ?? []).filter(
            (id) => !existingEvaluatorIds.includes(id),
        )

        // New evaluators inherit the run's evaluator origin (kind anchor).
        const newOrigin = (annotationSteps[0]?.origin as EvaluatorOrigin | undefined) ?? "auto"

        // edit REPLACES run data, so send the complete target set (existing + new).
        const evaluatorSteps: Record<string, EvaluatorOrigin> = {}
        for (const step of annotationSteps) {
            const id = step.references?.evaluator_revision?.id
            if (id) evaluatorSteps[id] = (step.origin as EvaluatorOrigin) ?? newOrigin
        }
        for (const id of fresh) evaluatorSteps[id] = newOrigin

        const editMutation = get(editRunShapeMutationAtom)
        await editMutation.mutateAsync({
            projectId,
            runId,
            name,
            description,
            querySteps: revisionOrigins(steps, "input", "query_revision"),
            testsetSteps: revisionOrigins(steps, "input", "testset_revision"),
            applicationSteps: revisionOrigins(steps, "invocation", "application_revision"),
            evaluatorSteps,
        })

        if (fresh.length) {
            const scenarioIds = await queryRunScenarioIds({projectId, runId})
            if (scenarioIds.length) {
                const processMutation = get(processRunSliceMutationAtom)
                await processMutation.mutateAsync({
                    projectId,
                    runId,
                    scenarioIds,
                    overwrite: false,
                })
            }
        }

        // Clear the shared batcher cache first, else the refetched run summary serves the
        // stale pre-edit run and the evaluations list never shows the change.
        invalidatePreviewRunCache(projectId, runId)

        const queryClient = get(queryClientAtom)
        await Promise.all([
            queryClient.invalidateQueries({
                queryKey: ["preview", "evaluation-run", runId, projectId],
            }),
            queryClient.invalidateQueries({queryKey: ["preview", "scenario-steps", runId]}),
            queryClient.invalidateQueries({queryKey: ["preview", "evaluation-metric", runId]}),
            queryClient.invalidateQueries({
                queryKey: ["preview", "run-level-metrics", projectId, runId],
            }),
            queryClient.invalidateQueries({
                queryKey: ["preview-evaluation-run-summary", projectId, runId],
            }),
            // Per-run stats map backing the list's evaluator-score cells. Prefix match
            // covers the trailing key parts (includeTemporal / isRunInProgress /
            // evaluationType). Without this, a cell in an ALREADY-EXISTING evaluator
            // column keeps the stale "empty" value the run had before the evaluator was
            // added — the query only re-keys on a status cycle, which may not be observed.
            queryClient.invalidateQueries({
                queryKey: ["preview", "run-metric-stats", projectId, runId],
            }),
        ])

        // The evaluations LIST table (its row.previewMeta carries the run's steps, which
        // drive the evaluator columns) is fed by the paginated runs query, which has its
        // OWN 10s TTL cache that React Query can't bypass. Clear it and background-refetch
        // the list root so the edited run's row picks up the new evaluator column. No-op
        // when the list isn't mounted (e.g. editing from the run-details page).
        // Also drop the in-memory metric-selection cache so refreshed stats aren't masked.
        clearPreviewRunsCache()
        clearMetricSelectionCache()
        await queryClient.refetchQueries({
            predicate: (query) =>
                Array.isArray(query.queryKey) && query.queryKey[0] === "evaluation-runs-table",
        })

        // `process` is an async 202 dispatch: the worker re-activates the run to RUNNING,
        // fills the new evaluator's cells, then finalizes back to terminal. Poll in the
        // background until that RUNNING→terminal cycle completes, then do a final
        // invalidation so the status indicator AND the scenario table (columns + every
        // cell, mounted or virtualized) converge to the finalized scores. Detached so the
        // drawer closes immediately.
        if (fresh.length) {
            void bridgeRunReprocessing(queryClient, projectId, runId)
        }
    },
)
