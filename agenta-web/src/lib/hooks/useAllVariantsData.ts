import type {SWRConfiguration} from "swr"
import {fetchSingleProfile, fetchVariants} from "@/services/api"
import {useState} from "react"
import {useVariants} from "./useVariants"
import {useAppsData} from "@/contexts/app.context"

interface UseEvaluationResultsOptions extends SWRConfiguration {
    appId?: string
}

export const useAllVariantsData = ({appId, ...rest}: UseEvaluationResultsOptions = {}) => {
    const {currentApp} = useAppsData()
    const [usernames, setUsernames] = useState<Record<string, string>>({})

    const {data, isLoading, error, mutate} = useVariants(currentApp)({
        appId,
        onSuccess: async (data, key, config) => {
            const variants = data?.variants || []
            const usernameMap: Record<string, string> = {}
            const uniqueModifiedByIds = Array.from(
                new Set(variants.map((variant) => variant.modifiedById)),
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
    })

    return {
        data: data?.variants || [],
        isLoading,
        error,
        mutate,
        usernames,
    }
}
