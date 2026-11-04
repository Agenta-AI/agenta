import {useCallback, useMemo} from "react"

import {INSTANCE_GROUP, analyticsIdentity} from "@agenta/shared/analytics"
import {useAtom} from "jotai"
import {type PostHog} from "posthog-js"

import useIsomorphicLayoutEffect from "@/oss/hooks/useIsomorphicLayoutEffect"
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
    const {
        id: analyticsId,
        properties: personProps,
        instanceId,
    } = useMemo(() => analyticsIdentity(user), [user])
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
        // No user id yet: stay anonymous. Identifying earlier (for example with a device
        // id) would block PostHog from merging this browser into the user's person.
        if (!analyticsId) return
        const key = JSON.stringify([analyticsId, personProps ?? null, instanceId])
        if (identifiedKey === key && posthog.get_distinct_id?.() === analyticsId) return

        identifiedKey = key
        identify(analyticsId, personProps)
        if (instanceId && trackingEnabled) posthog.group?.(INSTANCE_GROUP, instanceId)
    }, [analyticsId, identify, instanceId, personProps, posthog, trackingEnabled])

    if (!posthog) return null
    return Object.assign(posthog, {identify, capture}) as ExtendedPostHog
}
