import {useCallback, useEffect, useRef, useState} from "react"

import {useAtomValue} from "jotai"

import {capture, posthogAtom} from "@/features/analytics/client"
import {getEnv} from "@/lib/env"

import {
    ONBOARDING_EXPERIMENT_FLAG,
    parseOnboardingVariant,
    type OnboardingVariant,
} from "./onboardingChoices"

/** How long the flow waits for PostHog before it falls back to name first, unenrolled. */
export const ONBOARDING_FLAG_TIMEOUT_MS = 3000

export interface OnboardingAssignment {
    variant: OnboardingVariant
    /** Only an enrolled visitor emits the experiment's started, create and created events. */
    enrolled: boolean
}

const FALLBACK: OnboardingAssignment = {variant: "control", enrolled: false}

/** The variant for this mounted flow, fixed once resolved; `null` while PostHog answers. */
export const useOnboardingExperiment = (
    preview: OnboardingVariant | null,
): OnboardingAssignment | null => {
    const client = useAtomValue(posthogAtom)
    const [assignment, setAssignment] = useState<OnboardingAssignment | null>(() => {
        if (preview) return {variant: preview, enrolled: false}
        return getEnv("NEXT_PUBLIC_POSTHOG_API_KEY") ? null : FALLBACK
    })
    const settledRef = useRef(assignment !== null)

    const settle = useCallback((next: OnboardingAssignment) => {
        if (settledRef.current) return
        settledRef.current = true
        setAssignment(next)
        if (next.enrolled) capture("onboarding_started", {variant: next.variant})
    }, [])

    useEffect(() => {
        if (settledRef.current) return
        const timer = setTimeout(() => settle(FALLBACK), ONBOARDING_FLAG_TIMEOUT_MS)
        return () => clearTimeout(timer)
    }, [settle])

    useEffect(() => {
        if (!client || settledRef.current) return
        const read = () => {
            const variant = parseOnboardingVariant(
                client.getFeatureFlag(ONBOARDING_EXPERIMENT_FLAG),
            )
            if (variant) settle({variant, enrolled: true})
        }
        read()
        if (settledRef.current) return
        return client.onFeatureFlags(read)
    }, [client, settle])

    return assignment
}
