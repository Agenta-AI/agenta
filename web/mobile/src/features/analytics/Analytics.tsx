import {useEffect, useRef} from "react"

import {useProfile} from "@agenta/entities/profile"
import {setAgentCreationFailureReporter} from "@agenta/entities/workflow/agentCreationTelemetry"
import {analyticsIdentity, generateOrRetrieveDistinctId} from "@agenta/shared/analytics"
import {useAtom} from "jotai"
import {useRouter} from "next/router"

import {getEnv} from "@/lib/env"

import {capture, isAnalyticsAuthRoute, isCloudTelemetry, loadPostHog, posthogAtom} from "./client"
import {useInstanceTelemetry} from "./useInstanceTelemetry"

export const Analytics = () => {
    const router = useRouter()
    const {user} = useProfile()
    const [client, setClient] = useAtom(posthogAtom)
    const identityRef = useRef<string | null>(null)
    const aliasedIdRef = useRef<string | null>(null)
    const initialPageviewRef = useRef(false)
    const authRoute = isAnalyticsAuthRoute(router.asPath || router.pathname || "")
    // The API decides whether this instance sends events, and under which id.
    const telemetry = useInstanceTelemetry(user?.id)
    const keyed = Boolean(getEnv("NEXT_PUBLIC_POSTHOG_API_KEY"))
    const enabled = keyed && telemetry?.enabled === true
    // Signed out, the answer is unknown, not "off": opting out would outlive the next sign-in.
    const optedOut = !keyed || telemetry?.enabled === false
    const cloud = telemetry ? isCloudTelemetry(telemetry) : false
    const distinctId = telemetry?.distinct_id ?? null
    const instanceGroup = telemetry?.groups?.instance ?? null

    useEffect(() => {
        if (!enabled || authRoute) return
        let cancelled = false
        void loadPostHog(cloud).then((loaded) => {
            if (!cancelled && loaded) setClient(loaded)
        })
        return () => {
            cancelled = true
        }
    }, [enabled, cloud, authRoute, setClient])

    useEffect(() => {
        if (!client || !enabled || authRoute || !distinctId) return
        if (!user?.email) aliasedIdRef.current = null
        const baseId = generateOrRetrieveDistinctId()
        const {id, properties} = analyticsIdentity(user, cloud, distinctId)
        const key = JSON.stringify([id, properties, instanceGroup])
        if (identityRef.current === key) return
        try {
            if (
                cloud &&
                user?.email &&
                baseId !== id &&
                aliasedIdRef.current !== id &&
                client.get_distinct_id() !== id
            ) {
                client.alias(id, baseId)
                aliasedIdRef.current = id
            }
            // Self-hosted: a browser that holds another id (for example an email from
            // before) starts over, so nothing stored under that id is sent again.
            if (!cloud && client.get_distinct_id() !== id) client.reset()
            client.identify(id, properties)
            if (instanceGroup) client.group("instance", instanceGroup)
            identityRef.current = key
        } catch {
            // A blocked analytics client must not affect profile hydration.
        }
    }, [client, enabled, cloud, authRoute, user, distinctId, instanceGroup])

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
        if (optedOut) client?.opt_out_capturing()
    }, [authRoute, client, optedOut])

    return null
}
