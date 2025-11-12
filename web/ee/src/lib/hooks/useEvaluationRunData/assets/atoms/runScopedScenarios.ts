import deepEqual from "fast-deep-equal"
import {Atom, atom} from "jotai"
import {atomFamily, loadable} from "jotai/utils"
import {Loadable} from "jotai/vanilla/utils/loadable"
import {atomWithImmer} from "jotai-immer"

import {urlStateAtom} from "@/oss/components/EvalRunDetails/state/urlState"
import {getAgentaApiUrl} from "@/oss/lib/helpers/api"
import {
    evalAtomStore,
    evalScenarioFilterAtom,
} from "@/oss/lib/hooks/useEvaluationRunData/assets/atoms"
import {getJWT} from "@/oss/services/api"
import {getProjectValues} from "@/oss/state/project"

import {UseEvaluationRunScenarioStepsFetcherResult} from "../../../useEvaluationRunScenarioSteps/types"
import {fetchScenarioListViaWorker} from "../helpers/fetchScenarioListViaWorker"
import {fetchScenarioViaWorkerAndCache} from "../helpers/fetchScenarioViaWorker"

import {scenarioStatusAtomFamily} from "./progress"
import {bulkStepsStatusFamily, enrichedRunFamily, evaluationRunStateFamily} from "./runScopedAtoms"

/**
 * Run-scoped scenario atoms
 *
 * These atoms replace the global scenario atoms and are scoped to specific evaluation runs.
 * Each atom family is keyed by runId, allowing multiple evaluation runs to have
 * independent scenario state.
 */

// Atom family to force refetch of scenario steps - now scoped by runId
export const scenarioStepRefreshFamily = atomFamily(
    (params: {runId: string; scenarioId: string}) => atom(0),
    deepEqual,
)

// Per-scenario local cache that can be mutated independently - now scoped by runId
export const scenarioStepLocalFamily = atomFamily(
    (params: {runId: string; scenarioId: string}) =>
        atomWithImmer<UseEvaluationRunScenarioStepsFetcherResult>({}),
    deepEqual,
)

// Deduplicate in-flight fetches for scenario steps - now per runId
const scenarioStepInFlightMap = new Map<string, Map<string, Promise<any>>>()

export const scenarioStepFamily = atomFamily<
    {runId: string; scenarioId: string},
    Atom<Promise<UseEvaluationRunScenarioStepsFetcherResult | undefined>>
>((params) => {
    const {runId, scenarioId} = params
    return atom(async (get): Promise<UseEvaluationRunScenarioStepsFetcherResult | undefined> => {
        // Depend on refresh version so that incrementing it triggers refetch
        const refresh = get(scenarioStepRefreshFamily(params))

        // Access data directly from run-scoped atom instead of derived atoms
        const runState = get(evaluationRunStateFamily(runId))
        const evaluation = runState?.enrichedRun
        const runIndex = runState?.runIndex

        const inferEvaluationType = (): string | undefined => {
            const candidates = [
                runState?.rawRun && (runState.rawRun as any).evaluation_type,
                (runState?.rawRun as any)?.data?.evaluation_type,
                (runState?.rawRun as any)?.data?.evaluationType,
                (evaluation as any)?.evaluationType,
                (evaluation as any)?.evaluation_type,
                (evaluation as any)?.data?.evaluationType,
                (evaluation as any)?.data?.evaluation_type,
                (evaluation as any)?.meta?.evaluation_type,
                (evaluation as any)?.flags?.evaluation_type,
            ]
            for (const candidate of candidates) {
                if (typeof candidate === "string" && candidate.trim().length > 0) {
                    return candidate
                }
            }
            return undefined
        }

        const evaluationType = inferEvaluationType()
        const isOnlineEval =
            (evaluationType && evaluationType.toLowerCase() === "online") ||
            Boolean((evaluation as any)?.flags?.isLive) ||
            Boolean((runState?.rawRun as any)?.flags?.is_live)

        const testsetData = evaluation?.testsets?.[0]
        if (!runId || !evaluation || !runIndex) {
            console.warn(`[scenarioStepFamily] Missing runId/evaluation/runIndex for ${scenarioId}`)
            return undefined
        }

        if (!isOnlineEval && !testsetData) {
            console.warn(
                `[scenarioStepFamily] Missing testset data for ${scenarioId} (evaluationType=${evaluationType ?? "unknown"})`,
            )
            return undefined
        }

        // Wait if bulk fetch in-flight to avoid duplicate per-scenario fetches
        const status = get(bulkStepsStatusFamily(runId))
        if (status === "loading") {
            while (get(bulkStepsStatusFamily(runId)) === "loading") {
                await new Promise((r) => setTimeout(r, 16))
            }
        }

        const fetchParams = {
            runId,
            evaluation,
            runIndex,
        }

        // Get or create in-flight map for this runId
        if (!scenarioStepInFlightMap.has(runId)) {
            scenarioStepInFlightMap.set(runId, new Map())
        }
        const inFlightMap = scenarioStepInFlightMap.get(runId)!

        // Local cached value first
        const local = get(scenarioStepLocalFamily(params))
        if (local && Object.keys(local).length > 0) {
            if (refresh > 0 && !inFlightMap.has(scenarioId)) {
                const bgPromise = (async () => {
                    await fetchScenarioViaWorkerAndCache(fetchParams, [scenarioId])
                    evalAtomStore().set(scenarioStepRefreshFamily(params), 0)
                })()
                inFlightMap.set(scenarioId, bgPromise)
                bgPromise.finally(() => inFlightMap.delete(scenarioId))
            }
            return local
        }

        // Fallback to bulk cache - return undefined if not cached
        return undefined
    })
}, deepEqual)

// Loadable version of scenario step family - scoped by runId
export const loadableScenarioStepFamily = atomFamily(
    (params: {runId: string; scenarioId: string}) => loadable(scenarioStepFamily(params)),
    deepEqual,
)

// Scenarios atom - scoped by runId
export const scenariosFamily = atomFamily(
    (runId: string) =>
        atom((get) => {
            const state = get(evaluationRunStateFamily(runId))
            const scenarios = state.scenarios || []
            return scenarios
        }),
    deepEqual,
)

// Scenario IDs atom - scoped by runId
export const scenarioIdsFamily = atomFamily(
    (runId: string) =>
        atom((get) => {
            const scenarios = get(scenariosFamily(runId))
            return scenarios.map((s) => s.id)
        }),
    deepEqual,
)

// Total count atom - scoped by runId
export const totalCountFamily = atomFamily(
    (runId: string) =>
        atom((get) => {
            const scenarios = get(scenariosFamily(runId))
            return scenarios.length
        }),
    deepEqual,
)

// Scenario steps atom - aggregates all scenario steps for a run
export const scenarioStepsFamily = atomFamily(
    (runId: string) =>
        atom((get) => {
            const scenarioIds = get(scenarioIdsFamily(runId))
            const stepsMap: Record<
                string,
                Loadable<UseEvaluationRunScenarioStepsFetcherResult | undefined>
            > = {}

            scenarioIds.forEach((scenarioId) => {
                stepsMap[scenarioId] = get(loadableScenarioStepFamily({runId, scenarioId}))
            })

            return stepsMap
        }),
    deepEqual,
)

// Displayed scenario IDs with filtering - scoped by runId
export const displayedScenarioIdsFamily = atomFamily(
    (runId: string) =>
        atom((get) => {
            const scenarios = get(scenariosFamily(runId))
            const scenarioIds = scenarios.map((s: any) => s.id || s._id)

            // Get the current filter value from the global filter atom
            // Note: evalScenarioFilterAtom is global but that's OK since filter preference is shared across runs
            const filter = get(evalScenarioFilterAtom)

            // If filter is "all", return all scenarios
            if (filter === "all") {
                return scenarioIds
            }

            // Filter scenarios based on their status
            const filteredScenarioIds = scenarioIds.filter((scenarioId: string) => {
                const statusData = get(scenarioStatusAtomFamily({scenarioId, runId}))
                const status = statusData?.status || "pending"

                switch (filter) {
                    case "pending":
                        return status === "pending" || status === "revalidating"
                    case "unannotated":
                        return status === "incomplete"
                    case "failed":
                        return status === "failure"
                    default:
                        return true
                }
            })
            return filteredScenarioIds
        }),
    deepEqual,
)

/**
 * Helper functions for run-scoped scenario operations
 */

// Revalidate scenario function - now requires runId
export async function revalidateScenarioForRun(
    runId: string,
    scenarioId: string,
    store: ReturnType<typeof import("jotai").createStore>,
    updatedSteps?: UseEvaluationRunScenarioStepsFetcherResult["steps"],
) {
    // Apply optimistic override if requested

    // Bump refresh counter so the specific scenario refetches
    try {
        store.set(scenarioStepRefreshFamily({runId, scenarioId}), (v = 0) => v + 1)
    } catch (err) {
        console.error("[atoms] failed to bump scenario refresh counter", err)
    }

    // Return a promise that resolves when the refreshed data is available
    return store.get(scenarioStepFamily({runId, scenarioId}))
}

// Bulk prefetch function for run-scoped scenarios
export function attachBulkPrefetchForRun(
    runId: string,
    store: ReturnType<typeof import("jotai").createStore>,
) {
    // Subscribe to changes in displayed scenario IDs for this specific run
    const unsubscribe = store.sub(displayedScenarioIdsFamily(runId), () => {
        const scenarioIds = store.get(displayedScenarioIdsFamily(runId))
        if (scenarioIds.length > 0) {
            // Trigger bulk fetch for this specific run
            // The bulk fetch logic should work with run-scoped atoms
            try {
                // Import the bulk fetch function
                import("./bulkFetch").then(({runBulkFetch}) => {
                    runBulkFetch(store, runId, scenarioIds)
                })
            } catch (error) {
                console.error(
                    `attachBulkPrefetchForRun: Error triggering bulk fetch for ${runId.slice(0, 8)}:`,
                    error,
                )
            }
        }
    })

    return unsubscribe
}

// Scenario list prefetch function for run-scoped scenarios
// This fetches the scenarios for a run when the enriched run becomes available
export function attachScenarioListPrefetchForRun(
    runId: string,
    store: ReturnType<typeof import("jotai").createStore>,
) {
    const inferIsOnline = (runState: any, enrichedRun: any): boolean => {
        const candidates = [
            enrichedRun?.evaluationType,
            enrichedRun?.evaluation_type,
            enrichedRun?.meta?.evaluationType,
            enrichedRun?.meta?.evaluation_type,
            runState?.rawRun?.evaluation_type,
            runState?.rawRun?.data?.evaluation_type,
            runState?.rawRun?.data?.evaluationType,
        ]
        const hasOnlineType = candidates.some(
            (candidate) => typeof candidate === "string" && candidate.toLowerCase() === "online",
        )
        if (hasOnlineType) return true
        return Boolean(
            enrichedRun?.flags?.isLive ||
                enrichedRun?.flags?.is_live ||
                runState?.rawRun?.flags?.isLive ||
                runState?.rawRun?.flags?.is_live,
        )
    }

    // Subscribe to changes in enriched run for this specific run
    const unsubscribe = store.sub(enrichedRunFamily(runId), () => {
        const enrichedRun = store.get(enrichedRunFamily(runId))
        const currentScenarios = store.get(scenariosFamily(runId))
        const runState = store.get(evaluationRunStateFamily(runId))

        // Only fetch scenarios if we have an enriched run but no scenarios yet
        if (enrichedRun && currentScenarios.length === 0) {
            const fetchScenarios = async () => {
                try {
                    const {projectId} = getProjectValues()
                    const apiUrl = getAgentaApiUrl()
                    const jwt = await getJWT()

                    if (!jwt) {
                        console.warn(
                            `[attachScenarioListPrefetchForRun] No JWT available for ${runId}`,
                        )
                        return
                    }

                    const scenarios = await fetchScenarioListViaWorker({
                        apiUrl,
                        jwt,
                        projectId,
                        runId,
                        order: inferIsOnline(runState, enrichedRun) ? "descending" : undefined,
                    })
                    store.set(evaluationRunStateFamily(runId), (draft: any) => {
                        draft.scenarios = scenarios.map((s, idx) => ({
                            ...s,
                            scenarioIndex: idx + 1,
                        }))
                    })
                } catch (error) {
                    console.error(
                        `[attachScenarioListPrefetchForRun] Error fetching scenarios for ${runId}:`,
                        error,
                    )
                }
            }

            fetchScenarios()
        }
    })

    return unsubscribe
}

// Neighbor prefetch function for run-scoped scenarios
export function attachNeighbourPrefetchForRun(
    runId: string,
    store: ReturnType<typeof import("jotai").createStore>,
) {
    let lastScenarioId: string | null = null
    let latestUrl = store.get(urlStateAtom)
    let latestIds = store.get(scenarioIdsFamily(runId))

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
        const toFetch = allIds.filter(
            (id) => !store.get(scenarioStepLocalFamily({runId, scenarioId: id})),
        )
        if (!toFetch.length) {
            return
        }

        // Import and use run-scoped bulk fetch
        import("./bulkFetch").then(({runBulkFetch}) => {
            runBulkFetch(store, runId, toFetch, {force: true})
        })
    }

    // Subscribe to URL changes
    const unsubscribeUrl = store.sub(urlStateAtom, () => {
        latestUrl = store.get(urlStateAtom)
        maybePrefetch()
    })

    // Subscribe to scenario IDs availability/changes for this specific run
    const unsubscribeScenarios = store.sub(scenarioIdsFamily(runId), () => {
        latestIds = store.get(scenarioIdsFamily(runId))
        maybePrefetch()
    })

    // Return cleanup function that unsubscribes from both subscriptions
    return () => {
        unsubscribeUrl()
        unsubscribeScenarios()
    }
}
