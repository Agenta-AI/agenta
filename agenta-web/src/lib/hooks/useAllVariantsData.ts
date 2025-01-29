import {getCurrentProject} from "@/contexts/project.context"
import type {SWRConfiguration} from "swr"
import {getAgentaApiUrl} from "@/lib/helpers/utils"
import useSWR from "swr"
import {Variant} from "../Types"
import {fetchSingleProfile, fetchVariants} from "@/services/api"
import {useCallback, useState} from "react"

interface UseEvaluationResultsOptions extends SWRConfiguration {
    appId?: string
}

export const useAllVariantsData = ({appId, ...rest}: UseEvaluationResultsOptions = {}) => {
    const {projectId} = getCurrentProject()
    const [usernames, setUsernames] = useState<Record<string, string>>({})

    const fetcher = useCallback(
        async (url: string): Promise<Variant[]> => {
            const variants = await fetchVariants(appId!)
            return variants
        },
        [appId],
    )

    const {data, isLoading, error, mutate} = useSWR(
        appId && projectId
            ? `${getAgentaApiUrl()}/api/apps/${appId}/variants?project_id=${projectId}`
            : null,
        fetcher,
        {
            ...rest,
            revalidateOnFocus: false,
            shouldRetryOnError: false,
            onSuccess: async (data: Variant[], key, config) => {
                const usernameMap: Record<string, string> = {}
                const uniqueModifiedByIds = Array.from(
                    new Set(data.map((variant) => variant.modifiedById)),
                ).filter(Boolean)

                const profiles = await Promise.all(
                    uniqueModifiedByIds.map((id) => fetchSingleProfile(id)),
                )

                profiles.forEach((profile, index) => {
                    const id = uniqueModifiedByIds[index]
                    usernameMap[id] = profile?.username || "-"
                })

                setUsernames(usernameMap)
            },
        },
    )

    return {
        data,
        isLoading,
        error,
        mutate,
        usernames,
    }
}
