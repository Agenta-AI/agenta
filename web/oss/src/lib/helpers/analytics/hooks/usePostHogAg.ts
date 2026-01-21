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
    const aliasedRef = useRef(false)

    const personProps = useMemo(() => {
        if (!user?.email) return null
        const props: Record<string, unknown> = {email: user.email}
        if (user.username) {
            props.username = user.username
        }
        return props
    }, [user?.email, user?.username])
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
        if (posthog.get_distinct_id?.() === analyticsId) {
            identifiedRef.current = analyticsId
            return
        }
        if (identifiedRef.current === analyticsId) return
        if (isDemo() && user?.email && baseDistinctId !== analyticsId && !aliasedRef.current) {
            posthog.alias?.(analyticsId, baseDistinctId)
            aliasedRef.current = true
        }
        identifiedRef.current = analyticsId
        if (personProps) {
            identify(analyticsId, personProps)
        } else {
            identify(analyticsId)
        }
    }, [analyticsId, baseDistinctId, identify, personProps, posthog, user?.email])

    if (!posthog) return null
    return Object.assign(posthog, {identify, capture}) as ExtendedPostHog
}
