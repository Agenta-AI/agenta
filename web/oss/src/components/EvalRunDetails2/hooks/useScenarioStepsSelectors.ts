import {useMemo} from "react"

import {useAtomValue} from "jotai"
import {atom} from "jotai"
import {atomFamily} from "jotai/utils"

import {scenarioStepsQueryFamily} from "../atoms/scenarioSteps"
import type {IStepResponse} from "@/oss/lib/hooks/useEvaluationRunScenarioSteps/types"

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
            const query = get(
                scenarioStepsQueryFamily({scenarioId, runId: params?.runId ?? undefined}),
            )
            const steps = query.data?.steps ?? []
            let filtered: IStepResponse[] = steps

            if (params?.stepKey) {
                const match = filtered.find((step) => step.key === params.stepKey)
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
    family: ReturnType<typeof buildScenarioStepsSelector>,
) => {
    const params = useMemo(() => ({scenarioId, stepKey}), [scenarioId, stepKey])
    const atomInstance = useMemo(() => family(params), [family, params])
    return useAtomValue(atomInstance)
}

export const useScenarioInputSteps = (scenarioId: string | undefined, stepKey?: string) =>
    useScenarioStepsSelector(scenarioId, stepKey, scenarioInputStepsAtomFamily)

export const useScenarioInvocationSteps = (scenarioId: string | undefined, stepKey?: string) =>
    useScenarioStepsSelector(scenarioId, stepKey, scenarioInvocationStepsAtomFamily)

export const useScenarioAnnotationSteps = (scenarioId: string | undefined, stepKey?: string) =>
    useScenarioStepsSelector(scenarioId, stepKey, scenarioAnnotationStepsAtomFamily)
