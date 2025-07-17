import deepEqual from "fast-deep-equal"
import {Atom, atom, createStore} from "jotai"
import {atomFamily, selectAtom} from "jotai/utils"
import {loadable} from "jotai/utils"
import {Loadable} from "jotai/vanilla/utils/loadable"
import {eagerAtom} from "jotai-eager"
import {atomWithImmer} from "jotai-immer"

import {urlStateAtom} from "@/oss/components/EvalRunDetails/state/urlState"

import {IScenario} from "../../../useEvaluationRunScenarios/types"
import {UseEvaluationRunScenarioStepsFetcherResult} from "../../../useEvaluationRunScenarioSteps/types"
import {fetchScenarioViaWorkerAndCache} from "../helpers/fetchScenarioViaWorker"
import {filterScenarios} from "../helpers/scenarioFilters"

import {bulkStepsStatusAtom, runBulkFetch} from "./bulkFetch"
import {evaluationRunIdAtom} from "./derived"
import {evaluationRunStateAtom} from "./evaluationRunStateAtom"
import {evalScenarioFilterAtom} from "./utils"

import {enrichedRunAtom, runIndexAtom, evalAtomStore} from "."

// Atom family to force refetch of scenario steps
export const scenarioStepRefreshFamily = atomFamily((scenarioId: string) => atom(0), deepEqual)

// Per-scenario local cache that can be mutated independently
export const scenarioStepLocalFamily = atomFamily(
    (scenarioId: string) => atomWithImmer<UseEvaluationRunScenarioStepsFetcherResult>({}),
    deepEqual,
)

// Deduplicate in-flight fetches for scenario steps
const scenarioStepInFlight = new Map<string, Promise<any>>()

export const scenarioStepFamily = atomFamily<
    string,
    Atom<Promise<UseEvaluationRunScenarioStepsFetcherResult | undefined>>
>((scenarioId: string) => {
    return atom(async (get): Promise<UseEvaluationRunScenarioStepsFetcherResult | undefined> => {
        // Depend on refresh version so that incrementing it triggers refetch
        const refresh = get(scenarioStepRefreshFamily(scenarioId))

        const evaluation = get(enrichedRunAtom)
        const runId = get(evaluationRunIdAtom)
        const runIndex = get(runIndexAtom)

        const testsetData = evaluation?.testsets?.[0]
        if (!runId || !evaluation || !testsetData || !runIndex) {
            console.warn(
                `[scenarioStepFamily] Missing runId/evaluation/testsetData for ${scenarioId}`,
            )
            return undefined
        }

        // Wait if bulk fetch in-flight to avoid duplicate per-scenario fetches
        const status = get(bulkStepsStatusAtom)
        if (status === "loading") {
            while (get(bulkStepsStatusAtom) === "loading") {
                await new Promise((r) => setTimeout(r, 16))
            }
        }

        const fetchParams = {
            runId,
            evaluation,
            runIndex,
        }

        // Local cached value first
        const local = get(scenarioStepLocalFamily(scenarioId))
        if (local) {
            if (refresh > 0 && !scenarioStepInFlight.has(scenarioId)) {
                const bgPromise = (async () => {
                    await fetchScenarioViaWorkerAndCache([scenarioId], fetchParams)
                    evalAtomStore().set(scenarioStepRefreshFamily(scenarioId), 0)
                })()
                scenarioStepInFlight.set(scenarioId, bgPromise)
                bgPromise.finally(() => scenarioStepInFlight.delete(scenarioId))
            }
            return local
        }

        // // Fallback to bulk cache

        return undefined
    })
})

export const scenariosAtom = atom(
    (get) => get(evaluationRunStateAtom).scenarios || ([] as IScenario[]),
)

// Derived list of scenarioIds from evaluationRunStateAtom (empty until loaded)
export const scenarioIdsAtom = atom<string[]>((get) => {
    const scenarios = get(scenariosAtom)
    return scenarios?.map((s: any) => s.id) ?? []
})

// Lightweight total scenario count (no status reads)
export const totalCountAtom = selectAtom<string[], number>(
    scenarioIdsAtom,
    (ids) => ids.length,
    (a, b) => a === b,
)

export const evaluationScenariosDisplayAtom = eagerAtom((get) => {
    const evaluationRunState = get(evaluationRunStateAtom)
    const filter = get(evalScenarioFilterAtom)
    const scenarios = evaluationRunState.scenarios || []

    let filtered = filterScenarios(get, scenarios, filter)

    return filtered
})

// keep single Atom import at top, so no duplicate
export const displayedScenarioIds = eagerAtom<string[]>((get) => {
    return (get(evaluationScenariosDisplayAtom) || []).map((s: any) => s.id)
})

export const loadableScenarioStepFamily = atomFamily(
    (scenarioId: string) => loadable(scenarioStepFamily(scenarioId)),
    deepEqual,
)

export const scenarioStepsAtom = atom<
    Record<string, Loadable<UseEvaluationRunScenarioStepsFetcherResult>>
>((get) => {
    const scenarios = get(scenariosAtom)
    const steps: Record<string, any> = {}
    for (const scenario of scenarios) {
        steps[scenario.id] = get(loadable(scenarioStepFamily(scenario.id)))
    }
    return steps
})

// ---------------- Bulk Prefetch Attachment ----------------
// Moved from bulkFetch.ts to keep scenario-related logic together.
// Automatically kicks off a SINGLE bulk worker fetch once we know the full list of
// scenarioIds for the run. Subsequent scenarioId changes (e.g. pagination or filter
// expansion) will kick it off again with the new list.
//
// Logging:
//   • fires with runId + id count on every subscription event
//   • notes if we skip because list unchanged
export function attachBulkPrefetch(store: ReturnType<typeof createStore>) {
    const runScenarioMap = new Map<string, string[]>()
    store.sub(scenarioIdsAtom, () => {
        const runId = store.get(evaluationRunIdAtom)
        const ids = store.get(scenarioIdsAtom)
        if (ids.length && runId) {
            const prev = runScenarioMap.get(runId)
            console.debug("[attachBulkPrefetch] scenarioIds update", {runId, count: ids.length})
            if (!prev || !deepEqual(prev, ids)) {
                runScenarioMap.set(runId, ids)
                // Trigger bulk fetch in background
                console.info("[attachBulkPrefetch] Triggering bulk fetch", {runId})
                runBulkFetch(store, ids)
            }
        }
    })
}

// Prefetch active scenario + neighbours, only when view==="focus" and the scenarioId actually changed.
// Watches `urlStateAtom` and, when the user is in *focus* view and switches to a
// DIFFERENT scenario, prefetches its immediate neighbours so the next / previous
// buttons feel instant. Uses an internal `lastScenarioId` instead of an extra atom
// to avoid unnecessary store traffic.
//
// Logging:
//   • fires when a focus view change is detected
//   • logs neighbour ids before dispatching the worker fetch.
export function attachNeighbourPrefetch(store: ReturnType<typeof createStore>) {
    let lastScenarioId: string | null = null
    let latestUrl = store.get(urlStateAtom)
    let latestIds = store.get(scenarioIdsAtom)

    const maybePrefetch = () => {
        const {view, scenarioId} = latestUrl
        if (view !== "focus" || !scenarioId) return
        if (!latestIds.length) return
        if (scenarioId === lastScenarioId) return

        const idx = latestIds.indexOf(scenarioId)
        if (idx === -1) return

        lastScenarioId = scenarioId
        const neighbours = latestIds.filter((_, i) => Math.abs(i - idx) === 1)
        const allIds = [scenarioId, ...neighbours]
        const toFetch = allIds.filter((id) => !store.get(scenarioStepLocalFamily(id)))
        if (!toFetch.length) {
            console.debug("[attachNeighbourPrefetch] all neighbour steps already cached", {
                active: scenarioId,
            })
            return
        }
        runBulkFetch(store, toFetch, {force: true})
    }

    // subscribe to url changes
    store.sub(urlStateAtom, () => {
        latestUrl = store.get(urlStateAtom)
        console.debug("[attachNeighbourPrefetch] urlState changed", latestUrl)
        maybePrefetch()
    })

    // subscribe to scenarioIds availability/changes
    store.sub(scenarioIdsAtom, () => {
        latestIds = store.get(scenarioIdsAtom)
        maybePrefetch()
    })
}
