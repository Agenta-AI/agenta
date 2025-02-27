import {useCallback, useEffect, useRef} from "react"

import {isDemo} from "../../utils"

export const useSentryIntegrations = () => {
    const isLoading = useRef(false)

    const initializeSentryIntegrations = useCallback(async () => {
        try {
            const initSentry = await import(
                "@/oss/lib/helpers/sentry/lazyLoadSentryIntegrations"
            )
            initSentry?.lazyLoadSentryIntegrations?.()
        } catch (err) {
            console.error("Error loading sentry integrations", err)
        }
    }, [])

    useEffect(() => {
        if (!isLoading.current && isDemo()) {
            isLoading.current = true

            initializeSentryIntegrations()
        }
    }, [])
}
