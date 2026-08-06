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
 * Reasons we cannot proceed with the survey on this page render — permanent
 * (no key, survey gone) or transient (SDK blocked, fetch error, stall). All of
 * them trigger the same silent redirect to the resolved post-login path.
 */
export type PostSignupSkipReason =
    | "tracking-not-configured" // No PostHog API key → survey is not possible at all.
    | "survey-not-found" // PostHog returned no survey matching "Signup 3 - Agents" (deleted/renamed/inactive).
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

const SURVEY_NAME = "Signup 3 - Agents"

// Hard cap on how long the gate is allowed to stay in `loading` before we skip
// the survey and send the user onward. Deliberately shorter than useSurvey's
// internal 6s timeouts: a new user should never wait more than ~3s on a
// questionnaire we can live without.
const READINESS_WATCHDOG_MS = 3_000

const skipFromSurveyError = (error: SurveyError): PostSignupSkipReason => {
    switch (error.code) {
        case "posthog-not-configured":
            return "tracking-not-configured"
        case "survey-unavailable":
            return "survey-not-found"
        case "posthog-unavailable":
            return "posthog-load-failed"
        case "survey-fetch-error":
            return "survey-fetch-error"
        default:
            return "survey-fetch-error"
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
 * we skip the survey so the user can keep moving.
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
        return {status: "skip", reason: skipFromSurveyError(surveyError)}
    }

    if (watchdogFired) {
        return {status: "skip", reason: "watchdog-timeout"}
    }

    if (isStillLoading) {
        return {status: "loading"}
    }

    // TypeScript narrowing: isStillLoading guarantees these are non-null, but the
    // compiler can't see that across the closure, so reassert.
    if (!posthog || !user || !survey) {
        return {status: "skip", reason: "watchdog-timeout"}
    }

    return {
        status: "ready",
        user,
        survey,
        orgs: orgs ?? [],
        posthog,
    }
}
