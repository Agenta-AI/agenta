import {useCallback, useMemo, useRef} from "react"

import {useAtom} from "jotai"
import {type PostHog} from "posthog-js"

import useIsomorphicLayoutEffect from "@/oss/hooks/useIsomorphicLayoutEffect"
import {generateOrRetrieveDistinctId, isDemo} from "@/oss/lib/helpers/utils"
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
    const analyticsId = isDemo() && user?.email ? user.email : baseDistinctId
    const identifiedRef = useRef<string | null>(null)
    const emailIdentifiedRef = useRef<string | null>(null)
    const aliasedRef = useRef(false)

    const personProps = useMemo(() => {
        if (!user?.email) return undefined

        return {email: user.email}
    }, [user?.email])
    const baseCapture = posthog?.capture?.bind(posthog)
    const baseIdentify = posthog?.identify?.bind(posthog)
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
        if (!posthog) return
        if (!analyticsId) return
        if (!user?.email) {
            emailIdentifiedRef.current = null
            aliasedRef.current = false
        }

        const identifiedEmailKey = user?.email ? `${analyticsId}:${user.email}` : null
        const shouldIdentify =
            identifiedRef.current !== analyticsId ||
            (identifiedEmailKey !== null && emailIdentifiedRef.current !== identifiedEmailKey)

        if (!shouldIdentify) return

        if (isDemo() && user?.email && baseDistinctId !== analyticsId && !aliasedRef.current) {
            posthog.alias?.(analyticsId, baseDistinctId)
            aliasedRef.current = true
        }

        identifiedRef.current = analyticsId
        if (identifiedEmailKey) {
            emailIdentifiedRef.current = identifiedEmailKey
        }
        identify(analyticsId, personProps)
    }, [analyticsId, baseDistinctId, identify, personProps, posthog, user?.email])

    if (!posthog) return null
    return Object.assign(posthog, {identify, capture}) as ExtendedPostHog
}
