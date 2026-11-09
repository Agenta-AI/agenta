import {useCallback, useEffect, useRef, useState} from "react"

import {
    CLOUD_CONFIG,
    POSTHOG_CONFIG,
    SELF_HOSTED_CONFIG,
    generateOrRetrieveDistinctId,
    isCloudTelemetry,
    parseInstanceTelemetry,
} from "@agenta/shared/analytics"
import {useAtom} from "jotai"
import {useRouter} from "next/router"
import type {PostHog} from "posthog-js"

import axios from "@/oss/lib/api/assets/axiosConfig"
import {useProfileData} from "@/oss/state/profile"

import {getAgentaApiUrl} from "../api"
import {getEnv} from "../dynamicEnv"

import {useAgentCreationFailureReporter} from "./hooks/useAgentCreationFailureReporter"
import {instanceTelemetryAtom, posthogAtom, type PostHogConfig} from "./store/atoms"
import {CustomPosthogProviderType} from "./types"

const MAX_POSTHOG_INIT_ATTEMPTS = 3

const CustomPosthogProvider: CustomPosthogProviderType = ({children}) => {
    const router = useRouter()
    const [loadingPosthog, setLoadingPosthog] = useState(false)
    const [posthogClient, setPosthogClient] = useAtom(posthogAtom)
    const [telemetry, setTelemetry] = useAtom(instanceTelemetryAtom)
    const {user} = useProfileData()
    const userId = user?.id ?? null
    const failedAttemptsRef = useRef(0)
    const initCapturedRef = useRef(false)
    const currentPath = router.asPath || router.pathname || ""
    const isAuthRoute = currentPath.startsWith("/auth") && !currentPath.startsWith("/auth/callback")
    const isPostSignupRoute = currentPath.startsWith("/post-signup")

    useAgentCreationFailureReporter()

    // The API decides whether this instance sends events, and under which id.
    useEffect(() => {
        if (!userId) return
        let cancelled = false
        axios
            .get(`${getAgentaApiUrl()}/instance/telemetry`)
            .then(({data}) => {
                if (!cancelled) setTelemetry(parseInstanceTelemetry(data))
            })
            .catch(() => {
                // No answer: no analytics.
            })
        return () => {
            cancelled = true
        }
    }, [userId, setTelemetry])

    const cloud = telemetry ? isCloudTelemetry(telemetry) : false

    const initPosthog = useCallback(async () => {
        if (posthogClient) return
        if (loadingPosthog) return
        if (failedAttemptsRef.current >= MAX_POSTHOG_INIT_ATTEMPTS) return
        if (!getEnv("NEXT_PUBLIC_POSTHOG_API_KEY")) return
        if (!telemetry?.enabled) return

        setLoadingPosthog(true)

        try {
            const posthog = (await import("posthog-js")).default

            if (!getEnv("NEXT_PUBLIC_POSTHOG_API_KEY")) return

            posthog.init(getEnv("NEXT_PUBLIC_POSTHOG_API_KEY"), {
                ...POSTHOG_CONFIG,
                // Enable debug mode in development
                loaded: (posthog) => {
                    // the loaded callback narrows to PostHogInterface; the instance is the full client
                    setPosthogClient(posthog as PostHog)
                    failedAttemptsRef.current = 0
                    if (process.env.NODE_ENV === "development") posthog.debug()
                    if (!initCapturedRef.current) {
                        initCapturedRef.current = true
                        const distinctId = generateOrRetrieveDistinctId()
                        if (cloud && distinctId) {
                            posthog.identify?.(distinctId)
                        }
                        posthog.capture?.("$pageview", {$current_url: window.location.href})
                    }
                },
                ...((cloud ? CLOUD_CONFIG : SELF_HOSTED_CONFIG) as Partial<PostHogConfig>),
            })
        } catch (error) {
            failedAttemptsRef.current += 1
            if (failedAttemptsRef.current >= MAX_POSTHOG_INIT_ATTEMPTS) {
                console.warn("PostHog failed to initialize after maximum attempts", error)
            }
        } finally {
            setLoadingPosthog(false)
        }
    }, [loadingPosthog, posthogClient, setPosthogClient, telemetry, cloud])

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
