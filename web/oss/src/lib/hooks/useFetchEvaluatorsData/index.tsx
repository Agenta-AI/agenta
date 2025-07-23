import {useCallback} from "react"

import {useSetAtom} from "jotai"
import {SWRResponse} from "swr"

import {evaluatorConfigsAtom, evaluatorsAtom} from "../../atoms/evaluation"
import {Evaluator, EvaluatorConfig} from "../../Types"
import useEvaluatorConfigs from "../useEvaluatorConfigs"
import useEvaluators from "../useEvaluators"
import {EvaluatorPreviewDto} from "../useEvaluators/types"

interface EvaluatorsData<Preview extends boolean> {
    isLoadingEvaluators: boolean
    isLoadingEvaluatorConfigs: boolean
    refetchEvaluators: () => Promise<any>
    refetchEvaluatorConfigs: () => Promise<any>
    refetchAll: () => Promise<void>
    evaluatorsSwr: SWRResponse<Preview extends true ? EvaluatorPreviewDto[] : Evaluator[], any>
    evaluatorConfigsSwr: SWRResponse<Preview extends true ? undefined : EvaluatorConfig[], any>
}

const useFetchEvaluatorsData = <Preview extends boolean = false>(
    {preview, queries}: {preview?: Preview; queries?: {is_human: boolean}} = {
        preview: false as Preview,
    },
): EvaluatorsData<Preview> => {
    const setEvaluatorConfigs = useSetAtom(evaluatorConfigsAtom)
    const setEvaluators = useSetAtom(evaluatorsAtom)

    const evaluatorsSwr = useEvaluators({
        onSuccess(data, key, config) {
            setEvaluators(data)
        },
        preview,
        queries,
    })

    const evaluatorConfigsSwr = useEvaluatorConfigs({
        onSuccess(data, key, config) {
            setEvaluatorConfigs(data)
        },
        preview,
    })

    const refetchAll = useCallback(async () => {
        await Promise.all([evaluatorsSwr.mutate(), evaluatorConfigsSwr.mutate()])
    }, [])

    return {
        get isLoadingEvaluators() {
            return evaluatorsSwr.isLoading
        },
        get isLoadingEvaluatorConfigs() {
            return evaluatorConfigsSwr.isLoading
        },
        refetchEvaluators: evaluatorsSwr.mutate,
        refetchEvaluatorConfigs: evaluatorConfigsSwr.mutate,
        refetchAll,
        evaluatorsSwr,
        evaluatorConfigsSwr,
    }
}

export default useFetchEvaluatorsData
