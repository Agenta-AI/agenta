"use client"

import dynamic from "next/dynamic"

import {ONBOARDING_TOURS_ENABLED} from "@/oss/lib/onboarding"

// Lazy-loaded so the nextstepjs bundle (imported inside NextStepEngine) is only
// fetched/initialized when tours are enabled and this component actually renders.
const NextStepEngine = dynamic(() => import("./NextStepEngine"), {ssr: false})

/**
 * OnboardingProvider - Wraps the app with onboarding functionality
 *
 * Place this high in your component tree (e.g., in _app.tsx).
 *
 * @example
 * ```tsx
 * <OnboardingProvider>
 *   <App />
 * </OnboardingProvider>
 * ```
 */
export const OnboardingProvider = ({children}: {children: React.ReactNode}) => {
    // Guided tours are parked; see lib/onboarding/constants.ts. Render children
    // unchanged and skip loading nextstepjs entirely.
    if (!ONBOARDING_TOURS_ENABLED) return <>{children}</>

    return <NextStepEngine>{children}</NextStepEngine>
}

export default OnboardingProvider
