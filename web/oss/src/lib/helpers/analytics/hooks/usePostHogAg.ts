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
    const _id: string | undefined = isDemo() ? user?.email ?? baseDistinctId : baseDistinctId
    const identifiedRef = useRef<string | null>(null)
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
            const targetId = _id !== undefined ? _id : id
            if (!targetId) return
            baseIdentify?.(targetId, ...args)
        },
        [_id, baseIdentify, trackingEnabled],
    )
    useIsomorphicLayoutEffect(() => {
        if (!posthog) return

        if (!trackingEnabled) {
            posthog.opt_out_capturing()
        }
    }, [posthog, trackingEnabled])

    useIsomorphicLayoutEffect(() => {
        if (!posthog) return
        if (!_id) return
        if (identifiedRef.current === _id) return
        identifiedRef.current = _id
        identify(_id)
    }, [identify, posthog, _id])

    if (!posthog) return null
    return Object.assign(posthog, {identify, capture}) as ExtendedPostHog
}
