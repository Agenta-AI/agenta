import {getCurrentProject} from "@/contexts/project.context"
import type {SWRConfiguration} from "swr"
import {getAgentaApiUrl} from "@/lib/helpers/utils"
import Router from "next/router"
import useSWR from "swr"

interface UseEnvironmentOptions extends SWRConfiguration {
    appId?: string
}

export const useEnvironments = ({appId: propsAppId, ...rest}: UseEnvironmentOptions = {}) => {
    const {projectId} = getCurrentProject()
    const appId = propsAppId || (Router.query.app_id as string)

    const {data, error, mutate, isLoading} = useSWR(
        appId && projectId
            ? `${getAgentaApiUrl()}/api/apps/${appId}/environments?project_id=${projectId}`
            : null,
        {
            ...rest,
            revalidateOnFocus: false,
            shouldRetryOnError: false,
        },
    )

    return {
        environments: data || [],
        isEnvironmentsLoading: isLoading,
        isEnvironmentsLoadingError: error,
        mutate,
    }
}
