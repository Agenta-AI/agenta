import {useEffect, useMemo, useState, useCallback} from "react"
import {usePostHogAg} from "./usePostHogAg"
import {Survey} from "posthog-js"
import {shortPoll} from "../../utils"
import {useRouter} from "next/router"

export const useSurvey = (surveyName: string) => {
    const [survey, setSurvey] = useState<Survey | null>(null)
    const [isFetching, setIsFetching] = useState(false)

    const posthog = usePostHogAg()
    const router = useRouter()

    const loading = useMemo(() => {
        return isFetching || !posthog?.__loaded
    }, [isFetching, posthog?.__loaded])

    const fetchSurvey = useCallback(async () => {
        if (!!survey || isFetching || !posthog?.__loaded) return

        setIsFetching(true)

        const {stopper, promise} = shortPoll(
            () => {
                if (posthog?.__loaded) {
                    stopper()
                }
            },
            {delayMs: 500, timeoutMs: 2000},
        )

        promise
            .then(() => {
                if (posthog?.__loaded) {
                    posthog?.surveys?.getActiveMatchingSurveys?.((surveys) => {
                        const found = surveys?.find((s) => s.name.includes(surveyName)) ?? null
                        setSurvey(found)
                    }, false)

                    setIsFetching(false)
                }
            })
            .catch((error) => {
                console.error(error)
                router.push("/apps")
                setIsFetching(false)
            })
    }, [isFetching, surveyName, posthog?.__loaded])

    useEffect(() => {
        fetchSurvey()
    }, [fetchSurvey])

    return {
        survey,
        loading,
        mutate: fetchSurvey,
    }
}
