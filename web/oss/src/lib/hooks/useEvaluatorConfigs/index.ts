import {useEffect, useMemo} from "react"

import {useAtomValue} from "jotai"
import {SWRConfiguration} from "swr"

import {useAppId} from "@/oss/hooks/useAppId"
import {evaluatorConfigsQueryAtomFamily} from "@/oss/state/evaluators"

import {SimpleEvaluator} from "../../Types"

type EvaluatorConfigResult<Preview extends boolean> = Preview extends true
    ? undefined
    : SimpleEvaluator[]

type EvaluatorConfigsOptions<Preview extends boolean> = {
    preview?: Preview
    appId?: string | null
} & Pick<SWRConfiguration, "onSuccess" | "onError">

export interface UseEvaluatorConfigsReturn<Preview extends boolean> {
    data: EvaluatorConfigResult<Preview> | undefined
    error: unknown
    isLoading: boolean
    isPending: boolean
    isError: boolean
    isSuccess: boolean
    refetch: () => Promise<any>
    mutate: () => Promise<any>
}

const useEvaluatorConfigs = <Preview extends boolean = false>(
    {
        preview,
        appId: appIdOverride,
        onSuccess,
        onError,
    }: EvaluatorConfigsOptions<Preview> = {} as EvaluatorConfigsOptions<Preview>,
): UseEvaluatorConfigsReturn<Preview> => {
    const routeAppId = useAppId()
    const appId = appIdOverride ?? routeAppId

    const atomParams = useMemo(
        () => ({
            appId: appId || null,
            preview: Boolean(preview),
        }),
        [appId, preview],
    )

    const queryAtom = useMemo(() => evaluatorConfigsQueryAtomFamily(atomParams), [atomParams])

    const queryResult = useAtomValue(queryAtom)

    useEffect(() => {
        if (!onSuccess || preview) return
        if (!queryResult.isSuccess) return
        onSuccess(
            queryResult.data as EvaluatorConfigResult<Preview>,
            queryResult.queryKey ?? [],
            undefined,
        )
    }, [onSuccess, preview, queryResult.data, queryResult.isSuccess, queryResult.queryKey])

    useEffect(() => {
        if (!onError || preview) return
        if (!queryResult.isError) return
        onError(queryResult.error)
    }, [onError, preview, queryResult.error, queryResult.isError])

    return {
        data: queryResult.data as EvaluatorConfigResult<Preview> | undefined,
        error: queryResult.error,
        isLoading: queryResult.isPending,
        isPending: queryResult.isPending,
        isError: queryResult.isError,
        isSuccess: queryResult.isSuccess,
        refetch: queryResult.refetch,
        mutate: queryResult.refetch,
    }
}

export default useEvaluatorConfigs
