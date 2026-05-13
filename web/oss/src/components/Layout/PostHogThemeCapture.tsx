import {useEffect} from "react"

import {useAtom} from "jotai"
import {atomWithStorage} from "jotai/utils"

import {usePostHogAg} from "@/oss/lib/helpers/analytics/hooks/usePostHogAg"

import {getDeviceTheme} from "./ThemeContextProvider"

const hasCapturedThemeAtom = atomWithStorage<boolean>("hasCapturedTheme", false)

const PostHogThemeCapture = () => {
    const posthog = usePostHogAg()
    const [hasCaptured, setHasCaptured] = useAtom(hasCapturedThemeAtom)

    useEffect(() => {
        if (hasCaptured) return

        const deviceTheme = getDeviceTheme()
        posthog?.capture("user_device_theme", {
            $set: {deviceTheme},
        })

        setHasCaptured(true)
    }, [hasCaptured, posthog, setHasCaptured])

    return null
}

export default PostHogThemeCapture
