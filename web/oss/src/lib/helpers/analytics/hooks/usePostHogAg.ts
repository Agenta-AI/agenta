import {useCallback, useMemo, useRef} from "react"

import {analyticsIdentity, generateOrRetrieveDistinctId} from "@agenta/shared/analytics"
import {useAtom} from "jotai"
import {type PostHog} from "posthog-js"

import useIsomorphicLayoutEffect from "@/oss/hooks/useIsomorphicLayoutEffect"
import {isDemo} from "@/oss/lib/helpers/utils"
import {useProfileData} from "@/oss/state/profile"

import {getEnv} from "../../dynamicEnv"
import {posthogAtom} from "../store/atoms"

interface ExtendedPostHog extends PostHog {
    identify: PostHog["identify"]
    capture: PostHog["capture"]
}

export const usePostHogAg = (): ExtendedPostHog | null => {
    const trackingEnabled = getEnv("NEXT_PUBLIC_POSTHOG_API_KEY") !== ""
    const {user} = useProfileData()
    const [posthog] = useAtom(posthogAtom)
    const baseDistinctId = useMemo(() => generateOrRetrieveDistinctId(), [])
    const {id: analyticsId, properties: personProps} = useMemo(
        () => analyticsIdentity(user, isDemo(), baseDistinctId),
        [user, baseDistinctId],
    )
    const identifiedRef = useRef<string | null>(null)
    const personPropsIdentifiedRef = useRef<string | null>(null)
    const aliasedRef = useRef(false)

    const identifiedPersonPropsKey = useMemo(() => {
        return personProps ? `${analyticsId}:${JSON.stringify(personProps)}` : null
    }, [analyticsId, personProps])
    const baseCapture = useMemo(() => posthog?.capture?.bind(posthog), [posthog])
    const baseIdentify = useMemo(() => posthog?.identify?.bind(posthog), [posthog])
    const capture: PostHog["capture"] = useCallback(
        (...args) => {
            if (trackingEnabled) {
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
        if (!user?.email) {
            personPropsIdentifiedRef.current = null
            aliasedRef.current = false
        }
    }, [user?.email])

    useIsomorphicLayoutEffect(() => {
        if (!posthog) return
        if (!analyticsId) return
        const shouldIdentify =
            identifiedRef.current !== analyticsId ||
            (identifiedPersonPropsKey !== null &&
                personPropsIdentifiedRef.current !== identifiedPersonPropsKey)

        if (!shouldIdentify) return

        if (isDemo() && user?.email && baseDistinctId !== analyticsId && !aliasedRef.current) {
            posthog.alias?.(analyticsId, baseDistinctId)
            aliasedRef.current = true
        }

        identifiedRef.current = analyticsId
        if (identifiedPersonPropsKey) {
            personPropsIdentifiedRef.current = identifiedPersonPropsKey
        }
        identify(analyticsId, personProps)
    }, [analyticsId, baseDistinctId, identify, personProps, posthog, user?.email])

    if (!posthog) return null
    return Object.assign(posthog, {identify, capture}) as ExtendedPostHog
}
