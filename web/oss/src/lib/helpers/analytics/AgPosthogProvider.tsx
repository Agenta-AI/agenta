import {useCallback, useEffect, useRef, useState} from "react"

import {useAtom} from "jotai"
import {useRouter} from "next/router"

import {getEnv} from "../dynamicEnv"
import {generateOrRetrieveDistinctId, isDemo} from "../utils"

import {CLOUD_CONFIG, OSS_CONFIG} from "./assets/constants"
import {posthogAtom, type PostHogConfig} from "./store/atoms"
import {CustomPosthogProviderType} from "./types"

const MAX_POSTHOG_INIT_ATTEMPTS = 3

const CustomPosthogProvider: CustomPosthogProviderType = ({children}) => {
    const router = useRouter()
    const [loadingPosthog, setLoadingPosthog] = useState(false)
    const [posthogClient, setPosthogClient] = useAtom(posthogAtom)
    const failedAttemptsRef = useRef(0)
    const initCapturedRef = useRef(false)
    const currentPath = router.asPath || router.pathname || ""
    const isAuthRoute = currentPath.startsWith("/auth") && !currentPath.startsWith("/auth/callback")
    const isPostSignupRoute = currentPath.startsWith("/post-signup")

    const initPosthog = useCallback(async () => {
        if (posthogClient) return
        if (loadingPosthog) return
        if (failedAttemptsRef.current >= MAX_POSTHOG_INIT_ATTEMPTS) return
        if (!getEnv("NEXT_PUBLIC_POSTHOG_API_KEY")) return

        setLoadingPosthog(true)

        try {
            const posthog = (await import("posthog-js")).default

            if (!getEnv("NEXT_PUBLIC_POSTHOG_API_KEY")) return

            posthog.init(getEnv("NEXT_PUBLIC_POSTHOG_API_KEY"), {
                api_host: "https://alef.agenta.ai",
                ui_host: "https://us.posthog.com",
                // Enable debug mode in development
                loaded: (posthog) => {
                    setPosthogClient(posthog)
                    failedAttemptsRef.current = 0
                    if (process.env.NODE_ENV === "development") posthog.debug()
                    if (!initCapturedRef.current) {
                        initCapturedRef.current = true
                        const distinctId = generateOrRetrieveDistinctId()
                        if (distinctId) {
                            posthog.identify?.(distinctId)
                        }
                        posthog.capture?.("$pageview", {$current_url: window.location.href})
                    }
                },
                capture_pageview: false,
                ...((isDemo() ? CLOUD_CONFIG : OSS_CONFIG) as Partial<PostHogConfig>),
            })
        } catch (error) {
            failedAttemptsRef.current += 1
            if (failedAttemptsRef.current >= MAX_POSTHOG_INIT_ATTEMPTS) {
                console.warn("PostHog failed to initialize after maximum attempts", error)
            }
        } finally {
            setLoadingPosthog(false)
        }
    }, [loadingPosthog, posthogClient, setPosthogClient])

    useEffect(() => {
        // Initialize PostHog everywhere except auth routes (but DO initialize on post-signup for survey)
        if (!isAuthRoute || isPostSignupRoute) {
            initPosthog()
        }
    }, [initPosthog, isAuthRoute, isPostSignupRoute])


    const handleRouteChange = useCallback(() => {
        posthogClient?.capture("$pageview", {$current_url: window.location.href})
    }, [posthogClient])

    useEffect(() => {
        router.events.on("routeChangeComplete", handleRouteChange)

        return () => {
            router.events.off("routeChangeComplete", handleRouteChange)
        }
    }, [handleRouteChange, router.events])

    return <>{children}</>
}

const CustomPosthogProviderWrapper: CustomPosthogProviderType = ({children, config}) => {
    if (getEnv("NEXT_PUBLIC_POSTHOG_API_KEY")) {
        return <CustomPosthogProvider config={config}>{children}</CustomPosthogProvider>
    } else {
        return <>{children}</>
    }
}

export default CustomPosthogProviderWrapper
