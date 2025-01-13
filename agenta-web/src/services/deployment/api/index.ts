import {getCurrentProject} from "@/contexts/project.context"
import {Environment} from "@/lib/Types"
import axios from "@/lib/api/assets/axiosConfig"
import {getAgentaApiUrl} from "@/lib/helpers/utils"
import Router from "next/router"
import useSWR from "swr"

//Prefix convention:
//  - fetch: GET single entity from server
//  - fetchAll: GET all entities from server
//  - create: POST data to server
//  - update: PUT data to server
//  - delete: DELETE data from server

export const useEnvironments = () => {
    const {projectId} = getCurrentProject()
    const appId = Router.query.app_id as string

    const {data, error, mutate, isLoading} = useSWR(
        appId && projectId
            ? `${getAgentaApiUrl()}/api/apps/${appId}/environments?project_id=${projectId}`
            : null,
        {
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

export const fetchEnvironments = async (appId: string): Promise<Environment[]> => {
    try {
        const {projectId} = getCurrentProject()

        const response = await axios.get(
            `${getAgentaApiUrl()}/api/apps/${appId}/environments?project_id=${projectId}`,
        )
        return response.data
    } catch (error) {
        throw new Error("Failed to fetch environments")
    }
}

export const createPublishVariant = async (variantId: string, environmentName: string) => {
    const {projectId} = getCurrentProject()

    await axios.post(`${getAgentaApiUrl()}/api/environments/deploy?project_id=${projectId}`, {
        environment_name: environmentName,
        variant_id: variantId,
    })
}
