import {useEffect, useMemo} from "react"

import {useAtomValue} from "jotai"
import {loadable} from "jotai/utils"

import {scenarioStepFamily} from "@/oss/lib/hooks/useEvaluationRunData/assets/atoms/runScopedScenarios"
import {UseEvaluationRunScenarioStepsFetcherResult} from "@/oss/lib/hooks/useEvaluationRunScenarioSteps/types"

type ScenarioStepLoadableState = ReturnType<
    typeof loadable<ReturnType<typeof scenarioStepFamily>>
>["state"]

const scenarioStepsCache = new Map<string, UseEvaluationRunScenarioStepsFetcherResult>()
const resolvedKeys = new Set<string>()

export const useCachedScenarioSteps = (
    runId?: string | null,
    scenarioId?: string | null,
): {
    data?: UseEvaluationRunScenarioStepsFetcherResult
    state: ScenarioStepLoadableState
    hasResolved: boolean
    error?: unknown
} => {
    const key = runId && scenarioId ? `${runId}::${scenarioId}` : null

    const loadableAtom = useMemo(() => {
        if (!runId || !scenarioId) return null
        return loadable(
            scenarioStepFamily({
                runId,
                scenarioId,
            }),
        )
    }, [runId, scenarioId])

    const stepLoadable = loadableAtom
        ? (useAtomValue(loadableAtom) as {
              state: ScenarioStepLoadableState
              data?: UseEvaluationRunScenarioStepsFetcherResult
          })
        : undefined

    useEffect(() => {
        if (!key || !stepLoadable) return
        if (stepLoadable.state === "hasData" && stepLoadable.data) {
            scenarioStepsCache.set(key, stepLoadable.data)
            resolvedKeys.add(key)
        }
    }, [key, stepLoadable])

    const cached = key ? scenarioStepsCache.get(key) : undefined
    const data =
        stepLoadable?.state === "hasData" && stepLoadable.data
            ? stepLoadable.data
            : cached !== undefined
              ? cached
              : undefined

    const state =
        stepLoadable?.state ?? (key ? (resolvedKeys.has(key) ? "stale" : "loading") : "loading")
    const hasResolved = key ? resolvedKeys.has(key) : false
    const error = stepLoadable?.state === "hasError" ? stepLoadable.error : undefined

    return {data, state, hasResolved, error}
}
