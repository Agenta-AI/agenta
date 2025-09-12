import {useCallback} from "react"

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

    const _id: string | undefined = isDemo() ? user?.email : generateOrRetrieveDistinctId()
    const capture: PostHog["capture"] = useCallback(
        (...args) => {
            if (trackingEnabled && user?.id) {
                return posthog?.capture?.(...args)
            }
            return undefined
        },
        [posthog, trackingEnabled, user?.id],
    )
    const identify: PostHog["identify"] = useCallback(
        (id, ...args) => {
            if (trackingEnabled && user?.id) {
                posthog?.identify?.(_id !== undefined ? _id : id, ...args)
            }
        },
        [_id, posthog, trackingEnabled, user?.id],
    )
    useIsomorphicLayoutEffect(() => {
        if (!posthog) return

        if (!trackingEnabled) {
            posthog.opt_out_capturing()
        }
    }, [posthog, trackingEnabled])

    useIsomorphicLayoutEffect(() => {
        if (!posthog) return
        if (posthog.get_distinct_id() !== _id) identify()
    }, [posthog, _id])

    return Object.assign({}, posthog, {identify, capture}) as ExtendedPostHog
}
