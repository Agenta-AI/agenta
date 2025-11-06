import {useCallback, useMemo, useRef} from "react"

import deepEqual from "fast-deep-equal"
import {type WritableDraft} from "immer"
import {atom, useAtomValue, useSetAtom} from "jotai"
import {selectAtom} from "jotai/utils"
import useSWR from "swr"

import {evalTypeAtom} from "@/oss/components/EvalRunDetails/state/evalType"
import {useAppId} from "@/oss/hooks/useAppId"
import axios from "@/oss/lib/api/assets/axiosConfig"
import {snakeToCamelCaseKeys} from "@/oss/lib/helpers/casing"
import {isDemo} from "@/oss/lib/helpers/utils"
import useEnrichEvaluationRun from "@/oss/lib/hooks/usePreviewEvaluations/assets/utils"
import {Evaluation, GenericObject, PreviewTestset} from "@/oss/lib/Types"
import {
    fetchAllEvaluationScenarios as fetchAllLegacyAutoEvaluationScenarios,
    fetchEvaluation as fetchLegacyAutoEvaluation,
} from "@/oss/services/evaluations/api"
import {
    fetchAllLoadEvaluationsScenarios,
    fetchLoadEvaluation as fetchLegacyEvaluationData,
} from "@/oss/services/human-evaluations/api"
import {fetchTestset} from "@/oss/services/testsets/api"
import {userAtom} from "@/oss/state/profile/selectors/user"
import {projectIdAtom} from "@/oss/state/project/selectors/project"
import {
    prefetchProjectVariantConfigs,
    setProjectVariantReferencesAtom,
} from "@/oss/state/projectVariantConfig"

import {collectProjectVariantReferences} from "../usePreviewEvaluations/projectVariantConfigs"

import {evalAtomStore, evaluationRunStateFamily, loadingStateAtom} from "./assets/atoms"
import {buildRunIndex} from "./assets/helpers/buildRunIndex"

const fetchLegacyScenariosData = async (
    evaluationId: string,
    evaluationObj: Evaluation,
    type: "auto" | "human" | null,
): Promise<GenericObject[]> => {
    if (type === "auto") {
        return fetchAllLegacyAutoEvaluationScenarios(evaluationId)
    } else {
        return new Promise((resolve) => {
            fetchAllLoadEvaluationsScenarios(evaluationId, evaluationObj).then((data) => {
                resolve(
                    data.map((item: GenericObject) => {
                        const numericScore = parseInt(item.score)
                        return {...item, score: isNaN(numericScore) ? null : numericScore}
                    }),
                )
            })
        })
    }
}

/**
 * Hook to manage and fetch evaluation run data and scenarios.
 *
 * This hook supports both preview and legacy evaluation runs, providing
 * functionality to fetch, enrich, and manage the state of evaluation data.
 * It utilizes SWR for data fetching and caching, and Jotai for state management.
 *
 * @param {string | null} evaluationTableId - The ID of the evaluation table to fetch data for.
 * @param {boolean} [debug=false] - Flag for enabling debug mode, which might provide additional logging or behavior.
 * @param {() => void} [onScenariosLoaded] - Optional callback to be invoked when scenarios are successfully loaded.
 *
 * @returns {object} An object containing SWR mutate functions and methods to refetch evaluation and scenarios data.
 */
const useEvaluationRunData = (evaluationTableId: string | null, debug = false, runId?: string) => {
    const evalType = useAtomValue(evalTypeAtom)
    const routeAppId = useAppId()
    // Get isPreview from run-scoped atom if runId is available
    const isPreviewSelector = useCallback((state: any) => state.isPreview, [])
    const isPreview = useAtomValue(
        useMemo(() => {
            if (!runId) return atom(false)
            return selectAtom(evaluationRunStateFamily(runId), isPreviewSelector, deepEqual)
        }, [runId, isPreviewSelector]),
    )

    const projectId = useAtomValue(projectIdAtom)
    const setProjectVariantReferences = useSetAtom(setProjectVariantReferencesAtom)
    const user = useAtomValue(userAtom)
    const requireUser = isDemo()
    const enrichRun = useEnrichEvaluationRun({debug, evalType})
    const suppressLoadingRef = useRef(false)

    // New fetcher for preview runs that fetches and enriches with testsetData
    const fetchAndEnrichPreviewRun = useCallback(async () => {
        const suppressLoading = suppressLoadingRef.current
        if (!evaluationTableId || !projectId || (requireUser && !user?.id)) {
            if (!suppressLoading) {
                evalAtomStore().set(loadingStateAtom, (draft) => {
                    draft.isLoadingEvaluation = false
                    draft.activeStep = null
                })
            }
            suppressLoadingRef.current = false
            return null
        }

        if (!suppressLoading) {
            evalAtomStore().set(loadingStateAtom, (draft) => {
                draft.isLoadingEvaluation = true
                draft.activeStep = "eval-run"
            })
        }

        try {
            const runRes = await axios.get(
                `/preview/evaluations/runs/${evaluationTableId}?project_id=${projectId}`,
            )
            const rawRun = snakeToCamelCaseKeys(runRes.data?.run)

            const runIndex = buildRunIndex(rawRun)

            const testsetIds = Array.from(
                Object.values(runIndex.steps || {})
                    .map((m: any) => m?.refs?.testset?.id)
                    .filter(Boolean)
                    .reduce((acc: Set<string>, id: string) => acc.add(id), new Set<string>()),
            ) as string[]

            const fetchedTestsets = (
                await Promise.all(
                    testsetIds.map((tid) => fetchTestset(tid, true).catch(() => null)),
                )
            ).filter(Boolean) as PreviewTestset[]

            if (!fetchedTestsets.length && evalType === "auto") {
                evalAtomStore().set(
                    evaluationRunStateFamily(runId || evaluationTableId),
                    (draft: any) => {
                        draft.rawRun = runRes.data?.run
                        draft.enrichedRun = rawRun
                        draft.runIndex = runIndex
                        draft.isPreview = true
                    },
                )
                return rawRun
            }

            if (!rawRun) {
                if (runId) {
                    evalAtomStore().set(evaluationRunStateFamily(runId), (draft) => {
                        draft.isPreview = false
                    })
                }
                return null
            }

            const enrichedRun = enrichRun ? enrichRun(rawRun, fetchedTestsets, runIndex) : null
            if (enrichedRun && (runId || evaluationTableId)) {
                const effectiveRunId = runId || evaluationTableId
                evalAtomStore().set(
                    evaluationRunStateFamily(effectiveRunId),
                    (draft: WritableDraft<any>) => {
                        draft.rawRun = runRes.data?.run
                        draft.isPreview = true
                        draft.enrichedRun = enrichedRun
                        draft.runIndex = runIndex
                    },
                )
            }

            if (!routeAppId && projectId && enrichedRun) {
                if (evalType !== "online") {
                    const references = collectProjectVariantReferences([enrichedRun], projectId)
                    setProjectVariantReferences(references)
                    prefetchProjectVariantConfigs(references)
                }
            }

            return enrichedRun
        } catch (error: any) {
            if (axios.isCancel?.(error) || error?.code === "ERR_CANCELED") {
                return null
            }
            throw error
        } finally {
            if (!suppressLoading) {
                evalAtomStore().set(loadingStateAtom, (draft) => {
                    draft.isLoadingEvaluation = false
                    draft.activeStep = null
                })
            }
            suppressLoadingRef.current = false
        }
    }, [enrichRun, evaluationTableId, projectId, runId, user?.id, requireUser])

    const swrKey =
        !!enrichRun && evaluationTableId && (!requireUser || !!user?.id)
            ? [
                  "previewRun",
                  evaluationTableId,
                  evalType,
                  projectId ?? "none",
                  requireUser ? (user?.id ?? "anon") : "no-user",
              ]
            : null

    const previewRunSwr = useSWR(swrKey, fetchAndEnrichPreviewRun, {
        revalidateIfStale: false,
        revalidateOnFocus: false,
        revalidateOnReconnect: false,
    })

    // New fetcher for legacy runs that fetches and enriches with testsetData
    const fetchAndEnrichLegacyRun = async () => {
        const rawRun =
            evalType === "auto"
                ? await fetchLegacyAutoEvaluation(evaluationTableId as string)
                : await fetchLegacyEvaluationData(evaluationTableId as string)
        if (!rawRun) return null

        if (evalType === "auto") {
            return rawRun
        }

        const testsetId = (rawRun?.testset as any)?._id
        let testsetData = testsetId ? await fetchTestset(testsetId) : null

        if (testsetData) {
            // @ts-ignore
            rawRun.testset = testsetData
        }
        return rawRun
    }

    // Legacy: Use SWR to load evaluation data if not a preview
    const legacyEvaluationSWR = useSWR(
        !!enrichRun && previewRunSwr.data === null && evaluationTableId
            ? ["legacyEval", evaluationTableId, evalType]
            : null,
        fetchAndEnrichLegacyRun,
        {
            onSuccess(data, key, config) {
                if (!data) return
                // Populate run-scoped atoms
                if (runId) {
                    evalAtomStore().set(evaluationRunStateFamily(runId), (draft) => {
                        draft.rawRun = data
                        draft.isPreview = false
                        // @ts-ignore
                        draft.enrichedRun = data
                    })
                }
            },
        },
    )

    // Legacy: Load scenarios once legacyEvaluation is available
    const legacyScenariosSWR = useSWR<GenericObject[], any>(
        !(isPreview ?? true) && legacyEvaluationSWR.data?.id && !!projectId
            ? ["legacyScenarios", evaluationTableId, projectId]
            : null,
        () =>
            fetchLegacyScenariosData(
                evaluationTableId as string,
                legacyEvaluationSWR.data as Evaluation,
                evalType,
            ),
    )

    return {
        // Mutate functions
        legacyEvaluationSWR,
        legacyScenariosSWR,
        refetchEvaluation(options?: {background?: boolean}) {
            const background = Boolean(options?.background)
            if (background) {
                suppressLoadingRef.current = true
            }
            const mutatePromise = isPreview
                ? previewRunSwr.mutate(undefined, {revalidate: true})
                : legacyEvaluationSWR.mutate(undefined, {revalidate: true})

            if (mutatePromise && typeof (mutatePromise as any)?.finally === "function") {
                return (mutatePromise as Promise<any>).finally(() => {
                    if (background) {
                        suppressLoadingRef.current = false
                    }
                })
            }

            if (background) {
                suppressLoadingRef.current = false
            }

            return Promise.resolve(mutatePromise as any)
        },
        refetchScenarios() {
            if (!isPreview) {
                return legacyScenariosSWR.mutate(undefined, {revalidate: true})
            }
            return Promise.resolve(null)
        },
    }
}

export default useEvaluationRunData
