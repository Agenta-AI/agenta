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

const SURVEY_TIMEOUT_MS = 6000

const createSurveyError = (code: SurveyErrorCode, message: string): SurveyError => {
    const error = new Error(message) as SurveyError
    error.code = code
    return error
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
        }, SURVEY_TIMEOUT_MS)

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
                let completed = false
                const unsubscribes: (() => void)[] = []
                const timeout = window.setTimeout(() => {
                    if (completed) return
                    completed = true
                    unsubscribes.forEach((unsubscribe) => unsubscribe())
                    reject(
                        createSurveyError("survey-fetch-error", "PostHog surveys failed to load"),
                    )
                }, SURVEY_TIMEOUT_MS)

                const complete = (callback: () => void) => {
                    if (completed) return
                    completed = true
                    window.clearTimeout(timeout)
                    unsubscribes.forEach((unsubscribe) => unsubscribe())
                    callback()
                }

                const readActiveMatchingSurveys = () => {
                    posthog.getActiveMatchingSurveys((surveys) => {
                        const found = surveys?.find((s) => s.name?.includes(surveyName))
                        if (!found) {
                            complete(() =>
                                reject(
                                    createSurveyError(
                                        "survey-unavailable",
                                        `Survey "${surveyName}" is not available`,
                                    ),
                                ),
                            )
                            return
                        }

                        complete(() => resolve(found))
                    }, false)
                }

                try {
                    const unsubscribeSurveys = posthog?.onSurveysLoaded?.((_surveys, context) => {
                        try {
                            if (context && !context.isLoaded) {
                                complete(() =>
                                    reject(
                                        createSurveyError(
                                            "survey-fetch-error",
                                            context.error ?? "PostHog surveys failed to load",
                                        ),
                                    ),
                                )
                                return
                            }

                            const unsubscribeFeatureFlags = posthog.onFeatureFlags?.(() => {
                                readActiveMatchingSurveys()
                            })

                            if (unsubscribeFeatureFlags) {
                                unsubscribes.push(unsubscribeFeatureFlags)
                            } else {
                                readActiveMatchingSurveys()
                            }
                        } catch (e: unknown) {
                            const error =
                                e instanceof Error
                                    ? createSurveyError("survey-fetch-error", e.message)
                                    : createSurveyError(
                                          "survey-fetch-error",
                                          "Failed to load survey",
                                      )
                            complete(() => reject(error))
                        }
                    })

                    if (unsubscribeSurveys) {
                        unsubscribes.push(unsubscribeSurveys)
                    }

                    if (completed) {
                        unsubscribes.forEach((unsubscribe) => unsubscribe())
                    }

                    if (!unsubscribeSurveys) {
                        complete(() =>
                            reject(
                                createSurveyError(
                                    "posthog-unavailable",
                                    "PostHog surveys are not available",
                                ),
                            ),
                        )
                    }
                } catch (e: unknown) {
                    const error =
                        e instanceof Error
                            ? createSurveyError("survey-fetch-error", e.message)
                            : createSurveyError("survey-fetch-error", "Failed to load survey")
                    complete(() => reject(error))
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
