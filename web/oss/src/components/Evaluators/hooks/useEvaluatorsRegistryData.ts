import {useCallback, useMemo} from "react"

import useEvaluators from "@/oss/lib/hooks/useEvaluators"
import useFetchEvaluatorsData from "@/oss/lib/hooks/useFetchEvaluatorsData"
import {Evaluator, SimpleEvaluator} from "@/oss/lib/Types"

import {EvaluatorCategory, EvaluatorPreview, EvaluatorRegistryRow} from "../assets/types"
import {
    sortEvaluatorRowsByCreatedAtDesc,
    transformEvaluatorConfigsToRows,
    transformEvaluatorsToRows,
} from "../assets/utils"

const HUMAN_QUERY = Object.freeze({is_human: true})

const useEvaluatorsRegistryData = (category: EvaluatorCategory) => {
    const {
        evaluatorsSwr: baseEvaluatorsSwr,
        evaluatorConfigsSwr,
        isLoadingEvaluators,
        refetchAll: refetchEvaluatorResources,
    } = useFetchEvaluatorsData()

    const humanEvaluatorsSwr = useEvaluators({
        preview: true,
        queries: HUMAN_QUERY,
    })

    const rows = useMemo<EvaluatorRegistryRow[]>(() => {
        let unsortedRows: EvaluatorRegistryRow[]

        if (category === "human") {
            const humanEvaluators = (humanEvaluatorsSwr.data || []) as EvaluatorPreview[]
            unsortedRows = transformEvaluatorsToRows(humanEvaluators, "human")
        } else {
            const evaluatorConfigs = (evaluatorConfigsSwr.data || []) as SimpleEvaluator[]
            const baseEvaluators = (baseEvaluatorsSwr.data || []) as Evaluator[]

            unsortedRows = transformEvaluatorConfigsToRows(
                evaluatorConfigs,
                category,
                baseEvaluators,
            )
        }

        return sortEvaluatorRowsByCreatedAtDesc(unsortedRows)
    }, [category, baseEvaluatorsSwr.data, evaluatorConfigsSwr.data, humanEvaluatorsSwr.data])

    const isLoading = useMemo(
        () =>
            category === "human"
                ? humanEvaluatorsSwr.isLoading
                : evaluatorConfigsSwr.isLoading || isLoadingEvaluators,
        [isLoadingEvaluators, evaluatorConfigsSwr.isLoading, humanEvaluatorsSwr.isLoading],
    )

    const refetchAll = useCallback(async () => {
        await Promise.all(
            [refetchEvaluatorResources(), humanEvaluatorsSwr.mutate?.()].filter(Boolean),
        )
    }, [refetchEvaluatorResources, humanEvaluatorsSwr.mutate])

    return {rows, isLoading, refetchAll}
}

export default useEvaluatorsRegistryData
