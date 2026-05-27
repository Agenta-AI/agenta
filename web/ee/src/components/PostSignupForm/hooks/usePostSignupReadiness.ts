import {useMemo} from "react"

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
 * Timeouts live in useSurvey (one for PostHog SDK load, one for the survey
 * fetch). This hook only routes their resulting error codes into the
 * skip vs. fallback partition.
 */
export const usePostSignupReadiness = (): PostSignupReadiness => {
    const posthog = usePostHogAg()
    const {user, loading: profileLoading} = useProfileData()
    const {orgs} = useOrgData()
    const {survey, loading: surveyLoading, error: surveyError} = useSurvey(SURVEY_NAME)

    return useMemo<PostSignupReadiness>(() => {
        if (surveyError) {
            const skip = skipFromSurveyError(surveyError)
            if (skip) return {status: "skip", reason: skip}
            const fallback = fallbackFromSurveyError(surveyError)
            if (fallback) return {status: "fallback", reason: fallback}
            // Unknown error code — treat as fallback so we don't silently lose the user.
            return {status: "fallback", reason: "survey-fetch-error"}
        }

        if (surveyLoading || profileLoading || !posthog || !user || !survey) {
            return {status: "loading"}
        }

        return {
            status: "ready",
            user,
            survey,
            orgs: orgs ?? [],
            posthog,
        }
    }, [orgs, posthog, profileLoading, survey, surveyError, surveyLoading, user])
}
