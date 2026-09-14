import {useEffect, useRef, useState} from "react"

import {usePostHogAg} from "@/oss/lib/helpers/analytics/hooks/usePostHogAg"

import {ONBOARDING_EXPERIMENT, type OnboardingVariant} from "./choices"

export function useOnboardingExperiment() {
    const posthog = usePostHogAg()
    const [variant, setVariant] = useState<OnboardingVariant | null>(null)
    const assigned = useRef(false)
    const [enrolled, setEnrolled] = useState(false)
    useEffect(() => {
        if (assigned.current) return
        const assign = () => {
            if (assigned.current) return true
            const value = posthog?.getFeatureFlag(ONBOARDING_EXPERIMENT)
            if (value !== "control" && value !== "task-first") return false
            assigned.current = true
            setVariant(value)
            setEnrolled(true)
            posthog?.capture("onboarding_started", {variant: value})
            return true
        }
        if (assign()) return
        const unsubscribe = posthog?.onFeatureFlags(() => assign())
        const timer = window.setTimeout(() => {
            if (assigned.current) return
            assigned.current = true
            setVariant("control")
        }, 3000)
        return () => {
            unsubscribe?.()
            window.clearTimeout(timer)
        }
    }, [posthog])
    return {variant, posthog, enrolled}
}
