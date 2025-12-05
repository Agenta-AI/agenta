import {useCallback} from "react"

import {useSetAtom} from "jotai"

import {evaluatorConfigsAtom, evaluatorsAtom} from "../../atoms/evaluation"
import useEvaluatorConfigs, {UseEvaluatorConfigsReturn} from "../useEvaluatorConfigs"
import useEvaluators, {UseEvaluatorsReturn} from "../useEvaluators"

interface EvaluatorsData<Preview extends boolean> {
    isLoadingEvaluators: boolean
    isLoadingEvaluatorConfigs: boolean
    refetchEvaluators: () => Promise<any>
    refetchEvaluatorConfigs: () => Promise<any>
    refetchAll: () => Promise<void>
    evaluatorsSwr: UseEvaluatorsReturn<Preview>
    evaluatorConfigsSwr: UseEvaluatorConfigsReturn<Preview>
}

const useFetchEvaluatorsData = <Preview extends boolean = false>(
    {
        preview,
        queries,
        appId,
    }: {preview?: Preview; queries?: {is_human: boolean}; appId?: string | null} = {
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
        appId: appId || null,
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
