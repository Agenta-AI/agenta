import {useMemo, useCallback} from "react"

// import {useAppId} from "@/oss/hooks/useAppId"

import axios from "@agenta/oss/src/lib/api/assets/axiosConfig"
import {EvaluationType} from "@agenta/oss/src/lib/enums"
import {
    abTestingEvaluationTransformer,
    fromEvaluationResponseToEvaluation,
    singleModelTestEvaluationTransformer,
} from "@agenta/oss/src/lib/transformers"
import {EvaluationResponseType, ListAppsItem} from "@agenta/oss/src/lib/Types"
import {useAtomValue} from "jotai"
import useSWR from "swr"

import {useAppId} from "@/oss/hooks/useAppId"
import {deleteEvaluations as deleteAutoEvaluations} from "@/oss/services/evaluations/api"
import {fetchAllEvaluations} from "@/oss/services/evaluations/api"
import {deleteEvaluations as deleteHumanEvaluations} from "@/oss/services/human-evaluations/api"
import {fetchAllLoadEvaluations, fetchEvaluationResults} from "@/oss/services/human-evaluations/api"
import {useAppsData} from "@/oss/state/app"
import {getProjectValues, projectIdAtom} from "@/oss/state/project"

import usePreviewEvaluations from "./usePreviewEvaluations"

const deleteRuns = async (ids: string[]) => {
    const {projectId} = getProjectValues()
    await axios.delete(`/preview/evaluations/runs/?project_id=${projectId}`, {
        data: {
            run_ids: ids,
        },
    })

    return ids
}

/**
 * Custom hook to manage evaluations, combining legacy evaluations and preview evaluations.
 *
 * @param {Object} params - Configuration object.
 * @param {boolean} [params.withPreview] - Whether to include preview evaluations.
 * @param {EvaluationType[]} params.types - List of evaluation types to filter.
 *
 * @returns {Object} An object containing:
 * - `legacyEvaluations`: SWR object with data, error, and loading state for legacy evaluations.
 * - `previewEvaluations`: Object with data and loading state for preview evaluations.
 * - `mergedEvaluations`: Combined list of legacy and preview evaluations.
 * - `isLoadingLegacy`: Loading state of legacy evaluations.
 * - `isLoadingPreview`: Loading state of preview evaluations.
 * - `refetch`: Function to refetch both legacy and preview evaluations.
 * - `handleDeleteEvaluations`: Function to delete evaluations by IDs.
 */
const useEvaluations = ({
    withPreview,
    types,
    evalType,
    appId: appIdOverride,
}: {
    withPreview?: boolean
    types: EvaluationType[]
    evalType?: "human" | "auto" | "custom"
    appId?: string | null
}) => {
    const routeAppId = useAppId()
    const appId = (appIdOverride ?? routeAppId) || undefined
    const {apps: availableApps = []} = useAppsData()
    const projectId = useAtomValue(projectIdAtom)

    const appIdsForScope = useMemo(() => {
        if (appId) return [appId]
        return (availableApps as ListAppsItem[])
            .map((application) => application.app_id)
            .filter((id): id is string => typeof id === "string" && id.length > 0)
    }, [appId, availableApps])

    /**
     * Fetches legacy evaluations for the given appId and transforms them into the required format.
     * Also fetches auto evaluations if the selected types require it.
     * Returns an object containing human and auto evaluations.
     */
    const legacyFetcher = useCallback(async () => {
        if (!projectId || appIdsForScope.length === 0) {
            return {
                humanEvals: [],
                autoEvals: [],
            }
        }

        const needsAutoEvaluations = types.some((type) =>
            [
                EvaluationType.human_a_b_testing,
                EvaluationType.single_model_test,
                EvaluationType.human_scoring,
                EvaluationType.auto_exact_match,
                EvaluationType.automatic,
            ].includes(type),
        )

        const responses = await Promise.all(
            appIdsForScope.map(async (targetAppId) => {
                const rawEvaluations: EvaluationResponseType[] = await fetchAllLoadEvaluations(
                    targetAppId,
                    projectId,
                )

                const preparedEvaluations = rawEvaluations
                    .map((evaluationResponse) => ({
                        evaluation: {
                            ...fromEvaluationResponseToEvaluation(evaluationResponse),
                            appId: targetAppId,
                        },
                        raw: evaluationResponse,
                    }))
                    .filter(({evaluation}) => types.includes(evaluation.evaluationType))

                const results = await Promise.all(
                    preparedEvaluations.map(({evaluation}) =>
                        fetchEvaluationResults(evaluation.id),
                    ),
                )

                const humanEvaluations = results
                    .map((result, index) => {
                        const {evaluation, raw} = preparedEvaluations[index]
                        if (!result) return undefined

                        if (evaluation.evaluationType === EvaluationType.single_model_test) {
                            const transformed = singleModelTestEvaluationTransformer({
                                item: evaluation,
                                result,
                            })
                            return {
                                ...transformed,
                                appId: targetAppId,
                                appName: evaluation.appName,
                            }
                        }

                        if (evaluation.evaluationType === EvaluationType.human_a_b_testing) {
                            if (Object.keys(result.votes_data || {}).length > 0) {
                                const transformed = abTestingEvaluationTransformer({
                                    item: raw,
                                    results: result.votes_data,
                                })
                                return {
                                    ...transformed,
                                    appId: targetAppId,
                                    appName: evaluation.appName,
                                }
                            }
                        }

                        return undefined
                    })
                    .filter((item): item is Record<string, any> => Boolean(item))
                    .filter(
                        (item: any) =>
                            item.resultsData !== undefined ||
                            !(Object.keys(item.scoresData || {}).length === 0) ||
                            item.avgScore !== undefined,
                    )

                const autoEvaluations = needsAutoEvaluations
                    ? (await fetchAllEvaluations(targetAppId))
                          .sort(
                              (a, b) =>
                                  new Date(b.created_at || 0).getTime() -
                                  new Date(a.created_at || 0).getTime(),
                          )
                          .map((evaluation) => ({
                              ...evaluation,
                              appId: targetAppId,
                          }))
                    : []

                return {
                    humanEvals: humanEvaluations,
                    autoEvals: autoEvaluations,
                }
            }),
        )

        const humanEvals = responses
            .flatMap((response) => response.humanEvals)
            .sort(
                (a, b) =>
                    new Date(b?.createdAt ?? 0).getTime() - new Date(a?.createdAt ?? 0).getTime(),
            )
        const autoEvals = responses.flatMap((response) => response.autoEvals)

        return {
            humanEvals,
            autoEvals,
        }
    }, [appIdsForScope, projectId, types])

    /**
     * SWR hook for fetching and caching legacy evaluations using the legacyFetcher.
     */
    const legacyEvaluations = useSWR(
        !projectId || appIdsForScope.length === 0
            ? null
            : ["legacy-evaluations", projectId, ...appIdsForScope],
        legacyFetcher,
    )

    /**
     * Hook for fetching preview evaluations if withPreview is enabled.
     */
    const previewFlags = useMemo(() => {
        if (evalType === "custom") {
            return {is_live: false}
        }
        return undefined
    }, [evalType])

    const previewEvaluations = usePreviewEvaluations({
        skip: !withPreview,
        types,
        appId,
        flags: previewFlags,
    })

    // Extract runs from preview evaluations
    const {runs} = previewEvaluations || {}

    /**
     * Lazily combines legacy and preview evaluations into a single array.
     * Returns an empty array if either source is not yet loaded.
     */
    const computeMergedEvaluations = useCallback(
        (evalType?: "human" | "auto") => {
            const legacyData = legacyEvaluations.data || {autoEvals: [], humanEvals: []}
            const legacyAuto = legacyData.autoEvals || []
            const legacyHuman = legacyData.humanEvals || []
            let filteredLegacy = []
            if (types.includes(EvaluationType.single_model_test)) {
                filteredLegacy = legacyHuman
            } else {
                filteredLegacy = legacyAuto
            }

            if (!runs || !Array.isArray(runs)) {
                return filteredLegacy
            }

            // Filtering out evaluations based on eval type
            let filteredRuns = []
            if (evalType === "human") {
                filteredRuns = runs.filter((run) =>
                    run?.data?.steps.some(
                        (step) => step.type === "annotation" && step.origin === "human",
                    ),
                )
                if (filteredLegacy.length > 0) {
                    const autoEvalLagecyRuns = filteredLegacy.filter(
                        (run) => run?.evaluation_type === "single_model_test",
                    )

                    filteredRuns = [...filteredRuns, ...autoEvalLagecyRuns]
                }
            } else if (evalType === "auto") {
                filteredRuns = runs
                    .filter((run) =>
                        run?.data?.steps.every(
                            (step) =>
                                step.type !== "annotation" ||
                                step.origin === "auto" ||
                                step.origin === undefined,
                        ),
                    )
                    .filter((run) => {
                        const isLive = run?.flags?.isLive === true || run?.flags?.is_live === true
                        const source =
                            typeof run?.meta?.source === "string"
                                ? run.meta.source.toLowerCase()
                                : undefined
                        const isOnlineSource = source === "online_evaluation_drawer"
                        return !isLive && !isOnlineSource
                    })
                if (filteredLegacy.length > 0) {
                    const autoEvalLagecyRuns = filteredLegacy.filter(
                        (run) => "aggregated_results" in run,
                    )

                    filteredRuns = [...filteredRuns, ...autoEvalLagecyRuns]
                }
            } else if (evalType === "custom") {
                filteredRuns = runs.filter((run) => {
                    const steps = Array.isArray(run?.data?.steps) ? run.data.steps : []
                    const hasCustomStep = steps.some(
                        (step: any) =>
                            step?.origin === "custom" ||
                            step?.type === "custom" ||
                            step?.metadata?.origin === "custom",
                    )
                    if (!hasCustomStep) return false

                    const source =
                        typeof run?.meta?.source === "string"
                            ? run.meta.source.toLowerCase()
                            : undefined
                    const isOnlineSource = source === "online_evaluation_drawer"
                    const isLive = run?.flags?.isLive === true || run?.flags?.is_live === true

                    return hasCustomStep && !isOnlineSource && !isLive
                })
            } else {
                filteredRuns = [...filteredLegacy, ...runs]
            }

            return filteredRuns.sort((a, b) => {
                return b.createdAtTimestamp - a.createdAtTimestamp
            })
        },
        [legacyEvaluations.data, runs, types, evalType],
    )

    /**
     * Refetches both legacy and preview evaluations in parallel.
     * Use this after mutations that affect evaluation data.
     */
    const refetchAll = useCallback(async () => {
        await Promise.all([legacyEvaluations.mutate(), previewEvaluations.swrData.mutate()])
    }, [legacyEvaluations, previewEvaluations])

    /**
     * Deletes evaluations by IDs, handling both legacy and preview evaluations.
     * Determines which IDs correspond to legacy or preview runs, deletes them accordingly, and refetches all data.
     * @param _ids - Single ID or array of IDs to delete
     */
    const handleDeleteEvaluations = useCallback(
        async (_ids: string[] | string) => {
            const ids = Array.isArray(_ids) ? _ids : typeof _ids === "string" ? [_ids] : []
            const listOfLegacyEvals =
                evalType === "auto"
                    ? legacyEvaluations.data?.autoEvals || []
                    : evalType === "human"
                      ? legacyEvaluations.data?.humanEvals || []
                      : []

            // Determine which IDs are legacy evaluations
            const legacyEvals = listOfLegacyEvals
                .filter((e) => ids.includes(e.key || e.id))
                .map((e) => e.key || e.id)

            // IDs that are preview runs
            const runsIds = ids.filter((id) => !legacyEvals.includes(id))
            try {
                if (legacyEvals.length > 0) {
                    if (evalType === "auto") {
                        await deleteAutoEvaluations(ids)
                    } else {
                        await deleteHumanEvaluations(ids)
                    }
                }

                if (runsIds.length > 0) {
                    await deleteRuns(runsIds)
                }
                await refetchAll()
            } catch (error) {
                console.error(error)
            }
        },
        [legacyEvaluations, refetchAll],
    )

    const mergedEvaluations = useMemo(
        () => computeMergedEvaluations(evalType),
        [computeMergedEvaluations, evalType],
    )

    return {
        legacyEvaluations,
        previewEvaluations,
        mergedEvaluations,
        isLoadingLegacy: legacyEvaluations.isLoading,
        isLoadingPreview: previewEvaluations?.swrData?.isLoading ?? false,
        refetch: refetchAll,
        handleDeleteEvaluations,
    }
}

export default useEvaluations
