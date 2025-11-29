import {useMemo} from "react"

import {useAtomValue} from "jotai"
import {atom} from "jotai"
import {atomFamily} from "jotai/utils"

import type {IStepResponse} from "@/oss/lib/hooks/useEvaluationRunScenarioSteps/types"

import {activePreviewRunIdAtom} from "../atoms/run"
import {scenarioStepsQueryFamily} from "../atoms/scenarioSteps"
import {evaluationRunIndexAtomFamily} from "../atoms/table/run"

interface ScenarioStepSelection {
    steps: IStepResponse[]
    isLoading: boolean
    isFetching: boolean
}

const emptySelectionAtom = atom<ScenarioStepSelection>({
    steps: [],
    isLoading: false,
    isFetching: false,
})

const buildScenarioStepsSelector = (kind: "input" | "invocation" | "annotation") =>
    atomFamily((params: {scenarioId?: string; stepKey?: string | null; runId?: string | null}) => {
        const scenarioId = params?.scenarioId
        if (!scenarioId) {
            return emptySelectionAtom
        }
        return atom((get) => {
            const effectiveRunId = params?.runId ?? get(activePreviewRunIdAtom) ?? undefined
            const query = get(scenarioStepsQueryFamily({scenarioId, runId: effectiveRunId}))
            const runIndex = get(evaluationRunIndexAtomFamily(effectiveRunId ?? null))
            const steps = query.data?.steps ?? []

            // Get the key set for the requested kind from runIndex
            const kindKeySet =
                kind === "input"
                    ? runIndex?.inputKeys
                    : kind === "invocation"
                      ? runIndex?.invocationKeys
                      : runIndex?.annotationKeys

            // Filter steps by kind using runIndex key sets
            // If runIndex is not available yet, return all steps (don't filter)
            let filtered: IStepResponse[] =
                runIndex && kindKeySet?.size
                    ? steps.filter((step: IStepResponse) => kindKeySet.has(step.stepKey ?? ""))
                    : steps

            if (params?.stepKey) {
                const match = filtered.find((step) => step.stepKey === params.stepKey)
                filtered = match ? [match] : filtered
            }

            return {
                steps: filtered,
                isLoading: Boolean(query.isLoading),
                isFetching: Boolean(query.isFetching),
            }
        })
    })

export const scenarioInputStepsAtomFamily = buildScenarioStepsSelector("input")
export const scenarioInvocationStepsAtomFamily = buildScenarioStepsSelector("invocation")
export const scenarioAnnotationStepsAtomFamily = buildScenarioStepsSelector("annotation")

const useScenarioStepsSelector = (
    scenarioId: string | undefined,
    stepKey: string | undefined,
    runId: string | undefined,
    family: ReturnType<typeof buildScenarioStepsSelector>,
) => {
    const params = useMemo(() => ({scenarioId, stepKey, runId}), [scenarioId, stepKey, runId])
    const atomInstance = useMemo(() => family(params), [family, params])
    return useAtomValue(atomInstance)
}

export const useScenarioInputSteps = (
    scenarioId: string | undefined,
    stepKey?: string,
    runId?: string,
) => useScenarioStepsSelector(scenarioId, stepKey, runId, scenarioInputStepsAtomFamily)

export const useScenarioInvocationSteps = (
    scenarioId: string | undefined,
    stepKey?: string,
    runId?: string,
) => useScenarioStepsSelector(scenarioId, stepKey, runId, scenarioInvocationStepsAtomFamily)

export const useScenarioAnnotationSteps = (
    scenarioId: string | undefined,
    stepKey?: string,
    runId?: string,
) => useScenarioStepsSelector(scenarioId, stepKey, runId, scenarioAnnotationStepsAtomFamily)
