import {useMemo} from "react"

import {UseEvaluationRunScenarioStepsFetcherResult} from "@/oss/lib/hooks/useEvaluationRunScenarioSteps/types"
import {EvaluationStatus} from "@/oss/lib/Types"

import {useCachedScenarioSteps} from "./useCachedScenarioSteps"

import {
    resolveErrorMessage,
    resolveStepFailure,
} from "../components/VirtualizedScenarioTable/assets/MetricCell/helpers"

type ScenarioStepsResult = {
    data?: UseEvaluationRunScenarioStepsFetcherResult
    state?: ReturnType<typeof useCachedScenarioSteps>["state"]
    hasResolved?: boolean
    error?: unknown
}

interface UseMetricStepErrorOptions {
    runId?: string | null
    scenarioId?: string | null
    metricKey: string
    fallbackKey?: string
    fullKey?: string
    stepKey?: string
    slugCandidates?: string[]
    scenarioStepsResult?: ScenarioStepsResult
}

export const useMetricStepError = ({
    runId,
    scenarioId,
    metricKey,
    fallbackKey,
    fullKey,
    stepKey,
    slugCandidates,
    scenarioStepsResult,
}: UseMetricStepErrorOptions) => {
    const shouldFetch = Boolean(runId && scenarioId)

    const fallbackResult = useCachedScenarioSteps(
        shouldFetch ? (runId ?? undefined) : undefined,
        shouldFetch ? (scenarioId ?? undefined) : undefined,
    )

    const effectiveResult = scenarioStepsResult ?? fallbackResult

    const {data, state, hasResolved, error} = effectiveResult

    const errorStep = useMemo(() => {
        if (!shouldFetch) return null

        if (!data && !hasResolved) return null

        if (state === "hasError") {
            return {
                status: EvaluationStatus.ERROR,
                error: resolveErrorMessage(error),
            }
        }

        if (!data) return null

        const defaultSlugCandidates = (() => {
            const derived: string[] = []
            const [baseSlug] = metricKey.split(".")
            if (baseSlug) derived.push(baseSlug)

            const fallbackSlug = fallbackKey?.split(".")?.[0]
            if (fallbackSlug && !derived.includes(fallbackSlug)) {
                derived.push(fallbackSlug)
            }
            const fullSlug = fullKey?.split(".")?.[0]
            if (fullSlug && !derived.includes(fullSlug)) {
                derived.push(fullSlug)
            }
            return derived
        })()

        const combinedSlugCandidates = (() => {
            const set = new Set<string>()
            defaultSlugCandidates.forEach((slug) => slug && set.add(slug))
            slugCandidates?.forEach((slug) => slug && set.add(slug))
            return Array.from(set)
        })()

        const failure = resolveStepFailure({
            data,
            scenarioId: scenarioId ?? "",
            slugCandidates: combinedSlugCandidates,
            stepKey,
            debug: {metricKey, runId},
        })

        return failure
    }, [
        shouldFetch,
        data,
        hasResolved,
        state,
        error,
        metricKey,
        fallbackKey,
        fullKey,
        slugCandidates,
        stepKey,
        scenarioId,
        runId,
    ])

    return {
        errorStep,
        scenarioSteps: data,
        scenarioStepsState: state,
        hasResolvedScenarioSteps: hasResolved,
        scenarioStepsError: error,
    }
}
