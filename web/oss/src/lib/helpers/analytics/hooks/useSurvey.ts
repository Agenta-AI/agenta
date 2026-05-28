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

const isSurveyRunning = (survey: Survey): boolean => {
    if (!survey.start_date) return false
    const now = Date.now()
    const startedAt = new Date(survey.start_date).getTime()
    if (Number.isNaN(startedAt) || startedAt > now) return false
    if (!survey.end_date) return true
    const endedAt = new Date(survey.end_date).getTime()
    if (Number.isNaN(endedAt)) return true
    return endedAt > now
}

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
                let unsubscribeSurveys: (() => void) | undefined
                let timeoutHandle: number | undefined

                const cleanup = () => {
                    if (timeoutHandle !== undefined) {
                        window.clearTimeout(timeoutHandle)
                        timeoutHandle = undefined
                    }
                    unsubscribeSurveys?.()
                    unsubscribeSurveys = undefined
                }

                const settle = (cb: () => void) => {
                    if (settled) return
                    settled = true
                    cleanup()
                    cb()
                }

                timeoutHandle = window.setTimeout(() => {
                    settle(() =>
                        reject(
                            createSurveyError(
                                "survey-fetch-error",
                                `Survey fetch timed out after ${SURVEY_FETCH_TIMEOUT_MS}ms`,
                            ),
                        ),
                    )
                }, SURVEY_FETCH_TIMEOUT_MS)

                // Two-stage wait:
                //   1. onSurveysLoaded fires after posthog.surveys is initialized AND the
                //      remote /api/surveys/ response has been processed. Without this gate,
                //      calling getSurveys too early (right after posthog.__loaded but before
                //      the surveys extension settles) makes the SDK fire the callback
                //      synchronously with an empty list + isLoaded:false, which we'd mis-
                //      interpret as "survey not found" and silently redirect away.
                //   2. We then call getSurveys (NOT getActiveMatchingSurveys) because the
                //      signup survey is type="api" and we render it ourselves. The SDK's
                //      eligibility filter inside getActiveMatchingSurveys checks an auto-
                //      generated internal_targeting_flag_key (from the "show once" schedule)
                //      that returns false for brand-new identified users before their flag
                //      context settles. getSurveys returns the raw list; we own the "show
                //      once" decision via our own backend on form submit.
                const runQuery = () => {
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

                    try {
                        getSurveys.call(
                            posthog,
                            (surveys: Survey[] | undefined) => {
                                const found = surveys?.find(
                                    (s) => s.name === surveyName && isSurveyRunning(s),
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
                }

                try {
                    const onSurveysLoaded = posthog?.onSurveysLoaded
                    if (typeof onSurveysLoaded !== "function") {
                        // Older SDK or surveys extension not present — fall back to a
                        // direct query and rely on the timeout to catch hangs.
                        runQuery()
                        return
                    }

                    const maybeUnsubscribe = onSurveysLoaded.call(
                        posthog,
                        (
                            _loadedSurveys: Survey[],
                            context?: {isLoaded: boolean; error?: string},
                        ) => {
                            if (context && !context.isLoaded) {
                                settle(() =>
                                    reject(
                                        createSurveyError(
                                            "survey-fetch-error",
                                            context.error ?? "PostHog surveys failed to load",
                                        ),
                                    ),
                                )
                                return
                            }
                            runQuery()
                        },
                    )
                    // onSurveysLoaded may fire its callback synchronously when surveys
                    // are already loaded. In that case settle() ran before this
                    // assignment, so we'd never unsubscribe; release it immediately.
                    if (settled) {
                        maybeUnsubscribe?.()
                    } else {
                        unsubscribeSurveys = maybeUnsubscribe
                    }
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
