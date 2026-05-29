import {useEffect, useRef, useState} from "react"

import type {User} from "@agenta/shared/types"
import {type Survey, type PostHog} from "posthog-js"

import {usePostHogAg} from "@/oss/lib/helpers/analytics/hooks/usePostHogAg"
import {type SurveyError} from "@/oss/lib/helpers/analytics/hooks/useSurvey"
import {useSurvey} from "@/oss/lib/helpers/analytics/hooks/useSurvey"
import type {Org} from "@/oss/lib/Types"
import {useOrgData} from "@/oss/state/org"
import {useProfileData} from "@/oss/state/profile"

/**
 * Reasons we can never proceed with the survey on this page render.
 * These trigger a redirect to /get-started.
 */
export type PostSignupSkipReason =
    | "tracking-not-configured" // No PostHog API key → survey is not possible at all.
    | "survey-not-found" // PostHog returned no survey matching "Signup 2" (deleted/renamed/inactive).

/**
 * Reasons we hit a transient failure. The user sees a small error UI with a
 * "Continue" button so the failure is visible (not a silent skip).
 */
export type PostSignupFallbackReason =
    | "posthog-load-failed" // The SDK script didn't load or failed to initialize.
    | "survey-fetch-error" // /api/surveys/ timed out or errored.
    | "watchdog-timeout" // Overall readiness budget exceeded — something stalled silently.

export type PostSignupReadiness =
    | {status: "loading"}
    | {
          status: "ready"
          user: User
          survey: Survey
          orgs: Org[]
          posthog: PostHog
      }
    | {status: "skip"; reason: PostSignupSkipReason}
    | {status: "fallback"; reason: PostSignupFallbackReason}

const SURVEY_NAME = "Signup 2"

// Hard cap on how long the gate is allowed to stay in `loading`. The internal
// timeouts in useSurvey already surface posthog/survey failures within 6s each,
// so this is a backstop for anything outside the survey hook — e.g., a profile
// query that never resolves, a user that comes back null, or any other state we
// didn't predict. 10s is long enough that real fetches finish comfortably but
// short enough that the user isn't staring at a spinner.
const READINESS_WATCHDOG_MS = 10_000

const skipFromSurveyError = (error: SurveyError): PostSignupSkipReason | null => {
    switch (error.code) {
        case "posthog-not-configured":
            return "tracking-not-configured"
        case "survey-unavailable":
            return "survey-not-found"
        default:
            return null
    }
}

const fallbackFromSurveyError = (error: SurveyError): PostSignupFallbackReason | null => {
    switch (error.code) {
        case "posthog-unavailable":
            return "posthog-load-failed"
        case "survey-fetch-error":
            return "survey-fetch-error"
        default:
            return null
    }
}

/**
 * Resolves every async dependency the post-signup page needs into a single
 * discriminated state. Components downstream of this hook never see "maybe
 * loaded" data: they either get a fully-populated payload or a clear failure
 * mode.
 *
 * The watchdog at the end is intentional defense-in-depth: useSurvey owns its
 * own timeouts, but anything outside it (profile query, org query, anything
 * future we add to the dependency list) is still subject to this single
 * upper-bound. If we ever spend more than READINESS_WATCHDOG_MS in `loading`,
 * we fall through to fallback so the user can keep moving.
 */
export const usePostSignupReadiness = (): PostSignupReadiness => {
    const posthog = usePostHogAg()
    const {user, loading: profileLoading} = useProfileData()
    const {orgs} = useOrgData()
    const {survey, loading: surveyLoading, error: surveyError} = useSurvey(SURVEY_NAME)

    const isStillLoading = surveyLoading || profileLoading || !posthog || !user || !survey
    const isReady = !surveyError && !isStillLoading

    const [watchdogFired, setWatchdogFired] = useState(false)
    // Track when the gate first entered (or re-entered) loading so the watchdog
    // measures actual elapsed wait time, not just renders.
    const loadingSinceRef = useRef<number | null>(null)

    useEffect(() => {
        if (surveyError || isReady) {
            loadingSinceRef.current = null
            if (watchdogFired) setWatchdogFired(false)
            return
        }

        // Still in loading. If this is the first render of this loading spell,
        // record the entry time so a re-render mid-loading doesn't reset the
        // budget.
        if (loadingSinceRef.current === null) {
            loadingSinceRef.current = Date.now()
        }
        const elapsed = Date.now() - loadingSinceRef.current
        const remaining = READINESS_WATCHDOG_MS - elapsed
        if (remaining <= 0) {
            setWatchdogFired(true)
            return
        }

        const handle = window.setTimeout(() => setWatchdogFired(true), remaining)
        return () => window.clearTimeout(handle)
    }, [isReady, surveyError, watchdogFired])

    if (surveyError) {
        const skip = skipFromSurveyError(surveyError)
        if (skip) return {status: "skip", reason: skip}
        const fallback = fallbackFromSurveyError(surveyError)
        if (fallback) return {status: "fallback", reason: fallback}
        return {status: "fallback", reason: "survey-fetch-error"}
    }

    if (watchdogFired) {
        return {status: "fallback", reason: "watchdog-timeout"}
    }

    if (isStillLoading) {
        return {status: "loading"}
    }

    // TypeScript narrowing: isStillLoading guarantees these are non-null, but the
    // compiler can't see that across the closure, so reassert.
    if (!posthog || !user || !survey) {
        return {status: "fallback", reason: "watchdog-timeout"}
    }

    return {
        status: "ready",
        user,
        survey,
        orgs: orgs ?? [],
        posthog,
    }
}
