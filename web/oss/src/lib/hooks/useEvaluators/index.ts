import {useEffect, useMemo} from "react"

import {useAtomValue} from "jotai"
import {SWRConfiguration} from "swr"

import {evaluatorsQueryAtomFamily} from "@/oss/state/evaluators"

import {Evaluator} from "../../Types"

import {EvaluatorPreviewDto, UseEvaluatorsOptions} from "./types"

export interface UseEvaluatorsReturn<Preview extends boolean> {
    data: (Preview extends true ? EvaluatorPreviewDto[] : Evaluator[]) | undefined
    error: unknown
    isLoading: boolean
    isPending: boolean
    isError: boolean
    isSuccess: boolean
    refetch: () => Promise<any>
    mutate: () => Promise<any>
}

const useEvaluators = <Preview extends boolean = false>({
    preview,
    queries,
    onSuccess,
    onError,
    projectId,
    ..._rest
}: UseEvaluatorsOptions & {
    preview?: Preview
    queries?: {is_human: boolean}
    onSuccess?: (
        data: (Preview extends true ? EvaluatorPreviewDto[] : Evaluator[]) | undefined,
        key: readonly unknown[],
        config: SWRConfiguration | undefined,
    ) => void
    onError?: (error: unknown) => void
} = {}): UseEvaluatorsReturn<Preview> => {
    const queriesKey = useMemo(() => JSON.stringify(queries ?? null), [queries])

    const atomParams = useMemo(
        () => ({
            projectId: projectId ?? null,
            preview: Boolean(preview),
            queriesKey,
        }),
        [projectId, preview, queriesKey],
    )

    const queryAtom = useMemo(() => evaluatorsQueryAtomFamily(atomParams), [atomParams])

    const queryResult = useAtomValue(queryAtom)

    useEffect(() => {
        if (!onSuccess || !queryResult.isSuccess) return
        onSuccess(
            queryResult.data as
                | (Preview extends true ? EvaluatorPreviewDto[] : Evaluator[])
                | undefined,
            queryResult.queryKey ?? [],
            undefined,
        )
    }, [onSuccess, queryResult.data, queryResult.isSuccess, queryResult.queryKey])

    useEffect(() => {
        if (!onError || !queryResult.isError) return
        onError(queryResult.error)
    }, [onError, queryResult.error, queryResult.isError])

    return {
        data: queryResult.data as
            | (Preview extends true ? EvaluatorPreviewDto[] : Evaluator[])
            | undefined,
        error: queryResult.error,
        isLoading: queryResult.isPending,
        isPending: queryResult.isPending,
        isError: queryResult.isError,
        isSuccess: queryResult.isSuccess,
        refetch: queryResult.refetch,
        mutate: queryResult.refetch,
    }
}

export default useEvaluators
