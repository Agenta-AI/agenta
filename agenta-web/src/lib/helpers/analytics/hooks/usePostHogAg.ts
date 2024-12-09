import {useLayoutEffect} from "react"
import {isDemo, generateOrRetrieveDistinctId} from "@/lib/helpers/utils"
import {useProfileData} from "@/contexts/profile.context"
import {useAtom} from "jotai"
import {posthogAtom} from "../store/atoms"
import {type PostHog} from "posthog-js"

export const usePostHogAg = () => {
    const trackingEnabled = process.env.NEXT_PUBLIC_TELEMETRY_TRACKING_ENABLED === "true"
    const {user} = useProfileData()
    const [posthog] = useAtom(posthogAtom)

    const _id: string | undefined = isDemo() ? user?.email : generateOrRetrieveDistinctId()
    const capture: PostHog["capture"] = (...args) => {
        if (trackingEnabled && user?.id) {
            return posthog?.capture?.(...args)
        }
        return undefined
    }
    const identify: PostHog["identify"] = (id, ...args) => {
        if (trackingEnabled && user?.id) {
            console.log("POSTHOG: identify")
            posthog?.identify?.(_id !== undefined ? _id : id, ...args)
        }
    }
    useLayoutEffect(() => {
        if (!posthog) return

        if (!trackingEnabled) {
            console.log("POSTHOG: opt_out_capturing")
            posthog.opt_out_capturing()
        }
    }, [posthog, trackingEnabled])

    useLayoutEffect(() => {
        if (!posthog) return
        if (posthog.get_distinct_id() !== _id) identify()
    }, [posthog, _id])

    return {...posthog, identify, capture}
}
