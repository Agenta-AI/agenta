import {useCallback} from "react"

import deepEqual from "fast-deep-equal"
import {useAtomValue} from "jotai"
import {selectAtom} from "jotai/utils"
import useSWR from "swr"

import {getCurrentProject} from "@/oss/contexts/project.context"
import {snakeToCamelCaseKeys} from "@/oss/lib/helpers/casing"
import {
    fetchAllLoadEvaluationsScenarios,
    fetchLoadEvaluation as fetchLegacyEvaluationData,
} from "@/oss/services/human-evaluations/api"
import {fetchTestset} from "@/oss/services/testsets/api"

import axios from "../../api/assets/axiosConfig"
import {Evaluation, GenericObject, PreviewTestSet} from "../../Types"
import useEnrichEvaluationRun from "../usePreviewEvaluations/assets/utils"

import {evaluationRunStateAtom, loadingStateAtom, evalAtomStore} from "./assets/atoms"
import {buildRunIndex} from "./assets/helpers/buildRunIndex"

const fetchLegacyScenariosData = async (
    evaluationId: string,
    evaluationObj: Evaluation,
): Promise<GenericObject[]> => {
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
const useEvaluationRunData = (
    evaluationTableId: string | null,
    debug = false,
    onScenariosLoaded?: () => void,
) => {
    const isPreview = useAtomValue(
        selectAtom(
            evaluationRunStateAtom,
            useCallback((state) => state.isPreview, []),
            deepEqual,
        ),
    )

    const {projectId} = getCurrentProject()
    const enrichRun = useEnrichEvaluationRun({debug})

    // New fetcher for preview runs that fetches and enriches with testsetData
    const fetchAndEnrichPreviewRun = useCallback(async () => {
        evalAtomStore().set(loadingStateAtom, (draft) => {
            draft.isLoadingEvaluation = true
            draft.activeStep = "eval-run"
        })
        const runRes = await axios.get(
            `/preview/evaluations/runs/${evaluationTableId}?project_id=${projectId}`,
        )
        const rawRun = snakeToCamelCaseKeys(runRes.data?.run)
        const runIndex = buildRunIndex(rawRun)

        // Extract ALL referenced testset ids via runIndex
        const testsetIds = Array.from(
            Object.values(runIndex.steps)
                .map((m: any) => m?.refs?.testset?.id)
                .filter(Boolean)
                .reduce((acc: Set<string>, id: string) => acc.add(id), new Set<string>()),
        ) as string[]

        const fetchedTestsets = (
            await Promise.all(testsetIds.map((tid) => fetchTestset(tid, true).catch(() => null)))
        ).filter(Boolean) as PreviewTestSet[]

        if (!fetchedTestsets || !fetchedTestsets.length) {
            console.error("[useEvaluationRunData] No testsets fetched")
            return null
        }

        if (rawRun) {
            const enrichedRun = enrichRun ? enrichRun(rawRun, fetchedTestsets, runIndex) : null
            if (enrichedRun) {
                evalAtomStore().set(evaluationRunStateAtom, (draft) => {
                    draft.rawRun = runRes.data?.run
                    draft.isPreview = true
                    draft.enrichedRun = enrichedRun
                    draft.runIndex = runIndex
                })
            }
            return enrichedRun
        } else {
            evalAtomStore().set(loadingStateAtom, (draft) => {
                draft.isLoadingEvaluation = false
                draft.activeStep = null
            })
            evalAtomStore().set(evaluationRunStateAtom, (draft) => {
                draft.isPreview = false
            })
            return null
        }
    }, [enrichRun, evaluationTableId, projectId])

    const previewRunSwr = useSWR(
        !!enrichRun && evaluationTableId ? ["previewRun", evaluationTableId] : null,
        fetchAndEnrichPreviewRun,
        {
            revalidateIfStale: false,
            revalidateOnFocus: false,
            revalidateOnReconnect: false,
        },
    )

    // New fetcher for legacy runs that fetches and enriches with testsetData
    const fetchAndEnrichLegacyRun = async () => {
        const rawRun = await fetchLegacyEvaluationData(evaluationTableId as string)
        if (!rawRun) return null
        const testsetId = rawRun?.testset?._id
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
            ? ["legacyEval", evaluationTableId]
            : null,
        fetchAndEnrichLegacyRun,
        {
            onSuccess(data, key, config) {
                if (!data) return
                evalAtomStore().set(evaluationRunStateAtom, (draft) => {
                    draft.rawRun = data
                    draft.isPreview = false
                    // @ts-ignore
                    draft.enrichedRun = data
                })
            },
        },
    )

    // Legacy: Load scenarios once legacyEvaluation is available
    const legacyScenariosSWR = useSWR<GenericObject[], any>(
        !(isPreview ?? true) && legacyEvaluationSWR.data?.id
            ? ["legacyScenarios", evaluationTableId]
            : null,
        () =>
            fetchLegacyScenariosData(
                evaluationTableId as string,
                legacyEvaluationSWR.data as Evaluation,
            ),
    )

    return {
        // Mutate functions
        legacyEvaluationSWR,
        legacyScenariosSWR,
        refetchEvaluation() {
            if (isPreview) {
                previewRunSwr.mutate()
            } else {
                legacyEvaluationSWR.mutate()
            }
        },
        refetchScenarios() {
            if (!isPreview) {
                legacyScenariosSWR.mutate()
            }
        },
    }
}

export default useEvaluationRunData
