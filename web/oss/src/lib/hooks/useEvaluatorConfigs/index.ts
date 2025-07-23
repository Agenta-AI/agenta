import {useCallback} from "react"

import useSWR from "swr"
import {SWRConfiguration} from "swr"

import {DEFAULT_UUID, getCurrentProject} from "@/oss/contexts/project.context"
import {useAppId} from "@/oss/hooks/useAppId"
import {fetchAllEvaluatorConfigs} from "@/oss/services/evaluators"

import {EvaluatorConfig} from "../../Types"

type EvaluatorConfigResult<Preview extends boolean> = Preview extends true
    ? undefined
    : EvaluatorConfig[]

const useEvaluatorConfigs = <Preview extends boolean = false>({
    preview,
    ...options
}: {preview?: Preview} & SWRConfiguration) => {
    const {projectId} = getCurrentProject()
    const appId = useAppId()

    const fetcher = useCallback(async () => {
        const data = await fetchAllEvaluatorConfigs(appId)
        return data as EvaluatorConfigResult<Preview>
    }, [projectId, appId])

    return useSWR<EvaluatorConfigResult<Preview>, any>(
        !preview && appId && projectId !== DEFAULT_UUID
            ? `/api/preview/evaluator_configs/?project_id=${projectId}&app_id=${appId}`
            : null,
        fetcher,
        {
            revalidateOnFocus: false,
            shouldRetryOnError: false,
            ...options,
        },
    )
}

export default useEvaluatorConfigs
