import {Survey} from "posthog-js"
import useSWR from "swr"

import {usePostHogAg} from "./usePostHogAg"

export const useSurvey = (surveyName: string) => {
    const posthog = usePostHogAg()

    const swr = useSWR<Survey | null>(
        // Only fetch when PostHog is loaded
        posthog?.__loaded ? ["survey", surveyName] : null,
        async () => {
            return await new Promise<Survey | null>((resolve, reject) => {
                try {
                    posthog?.surveys?.getActiveMatchingSurveys?.((surveys) => {
                        const found = surveys?.find((s) => s.name?.includes(surveyName)) ?? null
                        resolve(found)
                    }, false)
                } catch (e) {
                    reject(e)
                }
            })
        },
        {
            revalidateOnFocus: false,
            shouldRetryOnError: false,
        },
    )

    const loading = swr.isLoading || swr.isValidating

    return {
        survey: swr.data ?? null,
        loading,
        mutate: swr.mutate,
        error: swr.error as any,
    }
}
