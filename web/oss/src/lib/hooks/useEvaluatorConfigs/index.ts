import {useMemo, useCallback} from "react"

import {useAtomValue} from "jotai"
import useSWR, {SWRResponse} from "swr"
import {SWRConfiguration} from "swr"

import {useAppId} from "@/oss/hooks/useAppId"
import {fetchAllEvaluatorConfigs} from "@/oss/services/evaluators"
import {userAtom} from "@/oss/state/profile"
import {projectIdAtom} from "@/oss/state/project"

import {EvaluatorConfig} from "../../Types"

type EvaluatorConfigResult<Preview extends boolean> = Preview extends true
    ? undefined
    : EvaluatorConfig[]

const useEvaluatorConfigs = <Preview extends boolean = false>({
    preview,
    appId: appIdOverride,
    ...options
}: {preview?: Preview; appId?: string | null} & SWRConfiguration) => {
    const projectId = useAtomValue(projectIdAtom)
    const user = useAtomValue(userAtom)
    const routeAppId = useAppId()
    const appId = appIdOverride ?? routeAppId

    const fetcher = useCallback(async (): Promise<EvaluatorConfig[]> => {
        if (!projectId) {
            return []
        }
        const data = await fetchAllEvaluatorConfigs(appId, projectId)
        return data
    }, [projectId, appId])

    const swrKey = useMemo(() => {
        if (!user || preview || !projectId) return null
        return ["evaluator-configs", projectId, appId ?? null] as const
    }, [user, preview, projectId, appId])

    const response = useSWR<EvaluatorConfig[], any>(swrKey, fetcher, {
        revalidateOnFocus: false,
        shouldRetryOnError: false,
        ...options,
    }) as SWRResponse<EvaluatorConfigResult<Preview>, any>

    return response
}

export default useEvaluatorConfigs
