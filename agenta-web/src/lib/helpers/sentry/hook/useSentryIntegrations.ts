import {useEffect, useRef} from "react"
import {dynamicLib} from "../../dynamic"
import {isDemo} from "../../utils"

export const useSentryIntegrations = () => {
    const isLoading = useRef(false)

    const initilizeSentryIntegrations = async () => {
        const {lazyLoadSentryIntegrations} = await dynamicLib(
            "helpers/sentry/lazyLoadSentryIntegrations",
        )
        lazyLoadSentryIntegrations()
    }

    useEffect(() => {
        if (isLoading.current && isDemo()) return
        isLoading.current = true

        initilizeSentryIntegrations()
    }, [])
}
