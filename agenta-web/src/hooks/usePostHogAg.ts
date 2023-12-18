import {useProfileData} from "@/contexts/profile.context"
import {isDemo} from "@/lib/helpers/utils"
import {usePostHog} from "posthog-js/react"
import {useLayoutEffect} from "react"

export const usePostHogAg = () => {
    const trackingEnabled = process.env.NEXT_PUBLIC_TELEMETRY_TRACKING_ENABLED === "true"
    const {user} = useProfileData()
    const posthog = usePostHog()

    const _id: string | null = isDemo() ? user?.email : null!

    const capture: typeof posthog.capture = (...args) => {
        if (trackingEnabled && user?.id) {
            posthog.capture(...args)
        }
    }

    const identify: typeof posthog.identify = (id, ...args) => {
        if (trackingEnabled && user?.id) {
            posthog.identify(_id !== undefined ? _id : null, ...args)
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
