import {useEffect, useMemo, useRef, useState} from "react"

import {Survey} from "posthog-js"
import useSWR from "swr"

import {getEnv} from "../../dynamicEnv"

import {usePostHogAg} from "./usePostHogAg"

type SurveyErrorCode =
    | "posthog-not-configured"
    | "posthog-unavailable"
    | "survey-fetch-error"
    | "survey-unavailable"

export interface SurveyError extends Error {
    code: SurveyErrorCode
}

const POSTHOG_LOAD_TIMEOUT_MS = 6000
const SURVEY_FETCH_TIMEOUT_MS = 6000

const createSurveyError = (code: SurveyErrorCode, message: string): SurveyError => {
    const error = new Error(message) as SurveyError
    error.code = code
    return error
}

const isSurveyRunning = (survey: Survey): boolean => Boolean(survey.start_date) && !survey.end_date

export const useSurvey = (surveyName: string) => {
    const posthog = usePostHogAg()
    const trackingConfigured = getEnv("NEXT_PUBLIC_POSTHOG_API_KEY") !== ""
    const [manualError, setManualError] = useState<SurveyError | null>(null)
    const timeoutRef = useRef<number | null>(null)

    const posthogLoaded = Boolean((posthog as any)?.__loaded)

    useEffect(() => {
        if (!trackingConfigured) {
            setManualError((prev) => {
                if (prev?.code === "posthog-not-configured") return prev
                return createSurveyError(
                    "posthog-not-configured",
                    "PostHog analytics is not configured",
                )
            })
            return
        }

        setManualError((prev) => (prev?.code === "posthog-not-configured" ? null : prev))
    }, [trackingConfigured])

    useEffect(() => {
        if (!trackingConfigured) return
        if (posthogLoaded) {
            setManualError((prev) => (prev?.code === "posthog-unavailable" ? null : prev))
            if (timeoutRef.current) {
                window.clearTimeout(timeoutRef.current)
                timeoutRef.current = null
            }
            return
        }

        if (timeoutRef.current) return

        timeoutRef.current = window.setTimeout(() => {
            setManualError((prev) =>
                prev?.code
                    ? prev
                    : createSurveyError("posthog-unavailable", "PostHog failed to load"),
            )
        }, POSTHOG_LOAD_TIMEOUT_MS)

        return () => {
            if (!timeoutRef.current) return
            window.clearTimeout(timeoutRef.current)
            timeoutRef.current = null
        }
    }, [posthogLoaded, trackingConfigured])

    useEffect(() => {
        return () => {
            if (!timeoutRef.current) return
            window.clearTimeout(timeoutRef.current)
            timeoutRef.current = null
        }
    }, [])

    const swr = useSWR<Survey | null>(
        posthogLoaded && !manualError ? ["survey", surveyName] : null,
        async () => {
            return await new Promise<Survey | null>((resolve, reject) => {
                let settled = false
                const timeout = window.setTimeout(() => {
                    if (settled) return
                    settled = true
                    reject(
                        createSurveyError(
                            "survey-fetch-error",
                            `Survey fetch timed out after ${SURVEY_FETCH_TIMEOUT_MS}ms`,
                        ),
                    )
                }, SURVEY_FETCH_TIMEOUT_MS)

                const settle = (cb: () => void) => {
                    if (settled) return
                    settled = true
                    window.clearTimeout(timeout)
                    cb()
                }

                // We intentionally use getSurveys (not getActiveMatchingSurveys) because
                // our signup survey is type="api" and rendered by our own form. The SDK's
                // eligibility filter inside getActiveMatchingSurveys checks an auto-generated
                // internal_targeting_flag_key (for the "show once" schedule) that returns
                // false for brand-new identified users before their flag context settles —
                // so the survey is silently filtered out. getSurveys returns the raw list;
                // we own the "show once" decision via our own backend on form submit.
                try {
                    const getSurveys = posthog?.getSurveys
                    if (typeof getSurveys !== "function") {
                        settle(() =>
                            reject(
                                createSurveyError(
                                    "posthog-unavailable",
                                    "PostHog surveys API is not available",
                                ),
                            ),
                        )
                        return
                    }

                    getSurveys.call(
                        posthog,
                        (surveys: Survey[] | undefined) => {
                            const found = surveys?.find(
                                (s) => s.name?.includes(surveyName) && isSurveyRunning(s),
                            )
                            if (!found) {
                                settle(() =>
                                    reject(
                                        createSurveyError(
                                            "survey-unavailable",
                                            `Survey "${surveyName}" is not available`,
                                        ),
                                    ),
                                )
                                return
                            }
                            settle(() => resolve(found))
                        },
                        false,
                    )
                } catch (e: unknown) {
                    const error =
                        e instanceof Error
                            ? createSurveyError("survey-fetch-error", e.message)
                            : createSurveyError("survey-fetch-error", "Failed to load survey")
                    settle(() => reject(error))
                }
            })
        },
        {
            revalidateOnFocus: false,
            shouldRetryOnError: false,
        },
    )

    const swrError = swr.error as SurveyError | undefined

    const combinedError = useMemo(() => {
        if (manualError) return manualError
        if (swrError) return swrError
        return null
    }, [manualError, swrError])

    const loading = useMemo(() => {
        if (combinedError) return false
        if (!trackingConfigured) return false
        if (!posthogLoaded) return true
        return swr.isLoading || swr.isValidating
    }, [combinedError, posthogLoaded, swr.isLoading, swr.isValidating, trackingConfigured])

    const survey = combinedError ? null : (swr.data ?? null)

    return {
        survey,
        loading,
        error: combinedError,
    }
}
