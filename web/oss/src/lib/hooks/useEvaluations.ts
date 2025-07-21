import {useCallback} from "react"

import useSWR from "swr"

import {getCurrentProject} from "@/oss/contexts/project.context"
import {useAppId} from "@/oss/hooks/useAppId"
import {fetchAllEvaluations} from "@/oss/services/evaluations/api"
import {fetchAllLoadEvaluations, fetchEvaluationResults} from "@/oss/services/human-evaluations/api"
import {deleteEvaluations} from "@/oss/services/human-evaluations/api"

import axios from "../api/assets/axiosConfig"
import {EvaluationType} from "../enums"
import {
    abTestingEvaluationTransformer,
    fromEvaluationResponseToEvaluation,
    singleModelTestEvaluationTransformer,
} from "../transformers"
import {Evaluation, EvaluationResponseType} from "../Types"

import usePreviewEvaluations from "./usePreviewEvaluations"

const deleteRuns = async (ids: string[]) => {
    const {projectId} = getCurrentProject()
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
const useEvaluations = ({withPreview, types}: {withPreview?: boolean; types: EvaluationType[]}) => {
    const appId = useAppId()

    /**
     * Fetches legacy evaluations for the given appId and transforms them into the required format.
     * Also fetches auto evaluations if the selected types require it.
     * Returns an object containing human and auto evaluations.
     */
    const legacyFetcher = useCallback(async () => {
        // Fetch all legacy evaluations from the backend
        const _evals: EvaluationResponseType[] = await fetchAllLoadEvaluations(appId)
        // Transform API responses to Evaluation objects
        const evals: Evaluation[] = _evals.map(fromEvaluationResponseToEvaluation)
        // Fetch auto evaluations if any of the selected types require them
        const autoEvals = types.filter((type) =>
            [
                EvaluationType.human_a_b_testing,
                EvaluationType.single_model_test,
                EvaluationType.human_scoring,
            ].includes(type),
        ).length
            ? (await fetchAllEvaluations(appId)).sort(
                  (a, b) =>
                      new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime(),
              )
            : []
        // Fetch evaluation results for each evaluation
        const results = await Promise.all(
            evals.map((evaluation) => fetchEvaluationResults(evaluation.id)),
        )
        // Transform and filter evaluation results based on their type
        const newEvals = results
            .map((result, ix) => {
                const item = evals[ix]
                if (!types.includes(item.evaluationType)) return undefined
                if ([EvaluationType.single_model_test].includes(item.evaluationType)) {
                    return singleModelTestEvaluationTransformer({item, result})
                } else if ([EvaluationType.human_a_b_testing].includes(item.evaluationType)) {
                    if (Object.keys(result.votes_data || {}).length > 0) {
                        const item = _evals[ix]
                        return abTestingEvaluationTransformer({item, results: result.votes_data})
                    }
                }
            })
            .filter(Boolean)

        // Filter out undefined and incomplete evaluations, then sort by creation date (descending)
        const newEvalResults = newEvals
            .filter((evaluation) => evaluation !== undefined)
            .filter(
                (item: any) =>
                    item.resultsData !== undefined ||
                    !(Object.keys(item.scoresData || {}).length === 0) ||
                    item.avgScore !== undefined,
            )
            .sort(
                (a, b) =>
                    new Date(b?.createdAt ?? 0).getTime() - new Date(a?.createdAt ?? 0).getTime(),
            )

        return {
            humanEvals: newEvalResults,
            autoEvals,
        }
    }, [appId, types])

    /**
     * SWR hook for fetching and caching legacy evaluations using the legacyFetcher.
     */
    const legacyEvaluations = useSWR(
        appId ? `/api/evaluations/?app_id=${appId}` : null,
        legacyFetcher,
    )

    /**
     * Hook for fetching preview evaluations if withPreview is enabled.
     */
    const previewEvaluations = usePreviewEvaluations({
        skip: !withPreview,
        types,
    })

    // Extract runs from preview evaluations
    const {runs} = previewEvaluations || {}

    /**
     * Lazily combines legacy and preview evaluations into a single array.
     * Returns an empty array if either source is not yet loaded.
     */
    const computeMergedEvaluations = useCallback(() => {
        const legacyAuto = legacyEvaluations.data?.autoEvals || []
        const legacyHuman = legacyEvaluations.data?.humanEvals || []
        let filteredLegacy = []
        if (types.includes(EvaluationType.single_model_test)) {
            filteredLegacy = legacyHuman
        } else {
            filteredLegacy = legacyAuto
        }
        if (!legacyEvaluations.data || !runs) return []
        return [...filteredLegacy, ...runs].sort((a, b) => {
            return b.createdAtTimestamp - a.createdAtTimestamp
        })
    }, [legacyEvaluations.data, runs, types])

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
            // Determine which IDs are legacy evaluations
            const legacyEvals = (legacyEvaluations.data?.humanEvals || [])
                .filter((e) => ids.includes(e.key))
                .map((e) => e.key)

            // IDs that are preview runs
            const runsIds = ids.filter((id) => !legacyEvals.includes(id))
            try {
                if (legacyEvals.length > 0) {
                    await deleteEvaluations(ids)
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

    return {
        // SWR object for legacy evaluations
        legacyEvaluations,
        // Preview evaluations object
        previewEvaluations,
        // Merged evaluations getter, combines both sources
        get mergedEvaluations() {
            return computeMergedEvaluations()
        },
        // Loading state for legacy evaluations
        get isLoadingLegacy() {
            return legacyEvaluations.isLoading
        },
        // Loading state for preview evaluations
        get isLoadingPreview() {
            return previewEvaluations.swrData.isLoading
        },
        // Refetch function for all evaluation data
        refetch: refetchAll,
        // Handler to delete evaluations
        handleDeleteEvaluations,
    }
}

export default useEvaluations
