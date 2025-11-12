import {useMemo} from "react"

import {atom, useAtomValue} from "jotai"
import {loadable} from "jotai/utils"
import type {Loadable} from "jotai/vanilla/utils/loadable"

import {scenarioStepFamily, scenarioStepLocalFamily} from "./assets/atoms/runScopedScenarios"
import {UseEvaluationRunScenarioStepsFetcherResult} from "./useEvaluationRunScenarioSteps/types"

export type ScenarioStepSnapshotState = Loadable<unknown>["state"]

export const hasScenarioStepData = (
    data?: Partial<UseEvaluationRunScenarioStepsFetcherResult> | null,
): data is UseEvaluationRunScenarioStepsFetcherResult => {
    if (!data) return false
    const withContent =
        (Array.isArray((data as any).invocationSteps) &&
            (data as any).invocationSteps.length > 0) ||
        (Array.isArray((data as any).inputSteps) && (data as any).inputSteps.length > 0) ||
        (Array.isArray((data as any).annotationSteps) &&
            (data as any).annotationSteps.length > 0) ||
        (Array.isArray((data as any).steps) && (data as any).steps.length > 0) ||
        Boolean((data as any).trace)

    if (withContent) return true
    return Object.keys(data).length > 0
}

export const useScenarioStepSnapshot = (
    scenarioId: string,
    runId?: string | null,
): {
    data?: UseEvaluationRunScenarioStepsFetcherResult
    state: ScenarioStepSnapshotState
    rawState: ScenarioStepSnapshotState
    error?: unknown
} => {
    const loadableAtom = useMemo(() => {
        if (!runId) {
            return atom<Loadable<UseEvaluationRunScenarioStepsFetcherResult | undefined>>({
                state: "loading",
            } as Loadable<UseEvaluationRunScenarioStepsFetcherResult | undefined>)
        }
        return loadable(scenarioStepFamily({scenarioId, runId}))
    }, [runId, scenarioId])

    const localAtom = useMemo(() => {
        if (!runId) {
            return atom<UseEvaluationRunScenarioStepsFetcherResult | undefined>(undefined)
        }
        return scenarioStepLocalFamily({scenarioId, runId})
    }, [runId, scenarioId])

    const loadableStep = useAtomValue(loadableAtom)
    const localData = useAtomValue(localAtom) as
        | UseEvaluationRunScenarioStepsFetcherResult
        | undefined

    const resolvedData = useMemo(() => {
        const remoteData = loadableStep.state === "hasData" ? loadableStep.data : undefined
        if (hasScenarioStepData(remoteData)) {
            return remoteData
        }
        if (hasScenarioStepData(localData)) {
            return localData
        }
        return remoteData
    }, [loadableStep, localData])

    const state: ScenarioStepSnapshotState = hasScenarioStepData(resolvedData)
        ? "hasData"
        : loadableStep.state

    const error = loadableStep.state === "hasError" ? loadableStep.error : undefined

    return {
        data: resolvedData,
        state,
        rawState: loadableStep.state,
        error,
    }
}
