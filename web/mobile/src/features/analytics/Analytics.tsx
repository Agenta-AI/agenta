import {useEffect, useRef} from "react"

import {useProfile} from "@agenta/entities/profile"
import {setAgentCreationFailureReporter} from "@agenta/entities/workflow/agentCreationTelemetry"
import {analyticsIdentity, generateOrRetrieveDistinctId} from "@agenta/shared/analytics"
import {isEE} from "@agenta/shared/api/env"
import {useAtom} from "jotai"
import {useRouter} from "next/router"

import {getEnv} from "@/lib/env"

import {capture, isAnalyticsAuthRoute, loadPostHog, posthogAtom} from "./client"

export const Analytics = () => {
    const router = useRouter()
    const {user} = useProfile()
    const [client, setClient] = useAtom(posthogAtom)
    const identityRef = useRef<string | null>(null)
    const aliasedIdRef = useRef<string | null>(null)
    const initialPageviewRef = useRef(false)
    const authRoute = isAnalyticsAuthRoute(router.asPath || router.pathname || "")
    const enabled = Boolean(getEnv("NEXT_PUBLIC_POSTHOG_API_KEY"))

    useEffect(() => {
        if (!enabled || authRoute) return
        let cancelled = false
        void loadPostHog().then((loaded) => {
            if (!cancelled && loaded) setClient(loaded)
        })
        return () => {
            cancelled = true
        }
    }, [enabled, authRoute, setClient])

    useEffect(() => {
        if (!client || !enabled || authRoute) return
        if (!user?.email) aliasedIdRef.current = null
        const baseId = generateOrRetrieveDistinctId()
        const {id, properties} = analyticsIdentity(user, isEE(), baseId)
        const key = JSON.stringify([id, properties])
        if (identityRef.current === key) return
        try {
            if (
                isEE() &&
                user?.email &&
                baseId !== id &&
                aliasedIdRef.current !== id &&
                client.get_distinct_id() !== id
            ) {
                client.alias(id, baseId)
                aliasedIdRef.current = id
            }
            client.identify(id, properties)
            identityRef.current = key
        } catch {
            // A blocked analytics client must not affect profile hydration.
        }
    }, [client, enabled, authRoute, user])

    useEffect(() => {
        if (!client || !enabled) return
        const capturePageview = () => {
            if (!isAnalyticsAuthRoute(window.location.pathname)) {
                capture("$pageview", {$current_url: window.location.href})
            }
        }
        if (!authRoute && !initialPageviewRef.current) {
            capturePageview()
            initialPageviewRef.current = true
        }
        router.events.on("routeChangeComplete", capturePageview)
        return () => router.events.off("routeChangeComplete", capturePageview)
    }, [client, enabled, authRoute, router.events])

    useEffect(() => {
        if (!client || !enabled) return
        setAgentCreationFailureReporter((payload) => capture("agent_create_failed", payload))
        return () => setAgentCreationFailureReporter(null)
    }, [client, enabled])

    useEffect(() => {
        if (!client || !enabled || authRoute) return
        try {
            if (localStorage.getItem("hasCapturedTheme") === "true") return
            const deviceTheme = window.matchMedia("(prefers-color-scheme: dark)").matches
                ? "dark"
                : "light"
            capture("user_device_theme", {$set: {deviceTheme}})
            localStorage.setItem("hasCapturedTheme", "true")
        } catch {
            // Some browsers disable storage or media queries.
        }
    }, [client, enabled, authRoute])

    useEffect(() => {
        if (authRoute) {
            identityRef.current = null
            aliasedIdRef.current = null
        }
        if (!enabled) client?.opt_out_capturing()
    }, [authRoute, client, enabled])

    return null
}
