import {useLayoutEffect} from "react"
import {isDemo, generateOrRetrieveDistinctId} from "@/lib/helpers/utils"
import {usePostHog} from "posthog-js/react"
import {useProfileData} from "@/contexts/profile.context"

export const usePostHogAg = () => {
    const trackingEnabled = process.env.NEXT_PUBLIC_TELEMETRY_TRACKING_ENABLED === "true"
    const {user} = useProfileData()
    const posthog = usePostHog()

    const _id: string | undefined = isDemo() ? user?.email : generateOrRetrieveDistinctId()

    const capture: typeof posthog.capture = (...args) => {
        if (trackingEnabled && user?.id) {
            posthog.capture(...args)
        }
    }

    const identify: typeof posthog.identify = (id, ...args) => {
        if (trackingEnabled && user?.id) {
            posthog.identify(_id !== undefined ? _id : id, ...args)
        }
    }

    useLayoutEffect(() => {
        if (!trackingEnabled) posthog.opt_out_capturing()
    }, [trackingEnabled])

    useLayoutEffect(() => {
        if (posthog.get_distinct_id() !== _id) identify()
    }, [user?.id])

    return {...posthog, identify, capture}
}
