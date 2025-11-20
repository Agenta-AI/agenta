import {useMemo} from "react"

import Router from "next/router"
import type {SWRConfiguration} from "swr"
import useSWR from "swr"

import {getCurrentProject} from "@/oss/contexts/project.context"
import {getAgentaApiUrl} from "@/oss/lib/helpers/utils"
import {Environment} from "@/oss/lib/Types"

interface UseEnvironmentOptions extends SWRConfiguration {
    appId?: string
}

const DEFAULT_ENVIRONMENTS: Environment[] = []

export const useEnvironments = ({appId: propsAppId, ...rest}: UseEnvironmentOptions = {}) => {
    const {projectId} = getCurrentProject()
    const appId = propsAppId || (Router.query.app_id as string)

    const {data, error, mutate, isLoading} = useSWR(
        appId && projectId
            ? `${getAgentaApiUrl()}/apps/${appId}/environments?project_id=${projectId}`
            : null,
        {
            ...rest,
            revalidateOnFocus: false,
            shouldRetryOnError: false,
        },
    )

    const environments = useMemo(() => {
        return (data || DEFAULT_ENVIRONMENTS) as Environment[]
    }, [data])

    return {
        environments,
        isEnvironmentsLoading: isLoading,
        isEnvironmentsLoadingError: error,
        mutate,
    }
}
