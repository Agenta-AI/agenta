import {useCallback, useMemo, useRef} from "react"

import {analyticsPersonProperties, isCloudTelemetry} from "@agenta/shared/analytics"
import {getDefaultStore, useAtom, useAtomValue} from "jotai"
import {type PostHog} from "posthog-js"

import useIsomorphicLayoutEffect from "@/oss/hooks/useIsomorphicLayoutEffect"
import {useProfileData} from "@/oss/state/profile"

import {getEnv} from "../../dynamicEnv"
import {instanceTelemetryAtom, posthogAtom} from "../store/atoms"

interface ExtendedPostHog extends PostHog {
    identify: PostHog["identify"]
    capture: PostHog["capture"]
}

export const usePostHogAg = (): ExtendedPostHog | null => {
    const trackingEnabled = getEnv("NEXT_PUBLIC_POSTHOG_API_KEY") !== ""
    const {user} = useProfileData()
    const [posthog] = useAtom(posthogAtom)
    const telemetry = useAtomValue(instanceTelemetryAtom)
    const cloud = telemetry ? isCloudTelemetry(telemetry) : false
    const instanceGroup = telemetry?.groups?.instance ?? null
    // Cloud and self-hosted both identify with the id the API gives.
    const analyticsId = telemetry?.distinct_id ?? ""
    const personProps = useMemo(() => analyticsPersonProperties(user, cloud), [user, cloud])
    const identifiedRef = useRef<string | null>(null)
    const personPropsIdentifiedRef = useRef<string | null>(null)

    const identifiedPersonPropsKey = useMemo(() => {
        return personProps ? `${analyticsId}:${JSON.stringify(personProps)}` : null
    }, [analyticsId, personProps])
    const baseCapture = useMemo(() => posthog?.capture?.bind(posthog), [posthog])
    const baseIdentify = useMemo(() => posthog?.identify?.bind(posthog), [posthog])
    const capture: PostHog["capture"] = useCallback(
        (...args) => {
            // Read at call time: other hooks keep a bound copy of this wrapper.
            if (trackingEnabled && getDefaultStore().get(instanceTelemetryAtom)?.enabled) {
                return baseCapture?.(...args)
            }
            return undefined
        },
        [baseCapture, trackingEnabled],
    )
    const identify: PostHog["identify"] = useCallback(
        (id, ...args) => {
            if (!trackingEnabled) return
            const targetId = id ?? analyticsId
            if (!targetId) return
            baseIdentify?.(targetId, ...args)
        },
        [analyticsId, baseIdentify, trackingEnabled],
    )
    useIsomorphicLayoutEffect(() => {
        if (!posthog) return

        if (!trackingEnabled) {
            posthog.opt_out_capturing()
        }
    }, [posthog, trackingEnabled])

    useIsomorphicLayoutEffect(() => {
        if (!user?.email) personPropsIdentifiedRef.current = null
    }, [user?.email])

    useIsomorphicLayoutEffect(() => {
        if (!posthog) return
        // No answer from the API yet (or a new user): no identity to send.
        if (!analyticsId) return
        const shouldIdentify =
            identifiedRef.current !== analyticsId ||
            (identifiedPersonPropsKey !== null &&
                personPropsIdentifiedRef.current !== identifiedPersonPropsKey)

        if (!shouldIdentify) return

        identifiedRef.current = analyticsId
        if (identifiedPersonPropsKey) {
            personPropsIdentifiedRef.current = identifiedPersonPropsKey
        }
        identify(analyticsId, personProps)
        if (instanceGroup) posthog.group?.("instance", instanceGroup)
    }, [analyticsId, identify, instanceGroup, personProps, posthog])

    if (!posthog) return null
    return Object.assign(posthog, {identify, capture}) as ExtendedPostHog
}
