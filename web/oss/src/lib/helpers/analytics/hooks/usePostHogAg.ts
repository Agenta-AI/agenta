import {useCallback, useMemo} from "react"

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

// Shared by every component that calls the hook, so each identity change is sent once.
let identifiedKey: string | null = null

export const usePostHogAg = (): ExtendedPostHog | null => {
    const trackingEnabled = getEnv("NEXT_PUBLIC_POSTHOG_API_KEY") !== ""
    const {user} = useProfileData()
    const [posthog] = useAtom(posthogAtom)
    const baseDistinctId = useMemo(() => generateOrRetrieveDistinctId(), [])
    const {id: analyticsId, properties: personProps} = useMemo(
        () => analyticsIdentity(user, isDemo(), baseDistinctId),
        [user, baseDistinctId],
    )
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
        if (!posthog) return
        if (!analyticsId) return
        // Cloud identifies by email only. PostHog merges the anonymous browser into the email
        // person on identify; an earlier identify(deviceId) would block that merge.
        if (isDemo() && !user?.email) return
        const key = JSON.stringify([analyticsId, personProps ?? null])
        if (identifiedKey === key && posthog.get_distinct_id?.() === analyticsId) return

        identifiedKey = key
        identify(analyticsId, personProps)
    }, [analyticsId, identify, personProps, posthog, user?.email])

    if (!posthog) return null
    return Object.assign(posthog, {identify, capture}) as ExtendedPostHog
}
