import deepEqual from "fast-deep-equal"
import {atom} from "jotai"
import {atomFamily} from "jotai/utils"

import {
    displayedScenarioIdsFamily,
    loadableScenarioStepFamily,
    scenarioStepLocalFamily,
} from "@/oss/lib/hooks/useEvaluationRunData/assets/atoms/runScopedScenarios"

import {EvaluatorFailure, hasFailureStatus, resolveErrorMessage} from "../MetricCell/helpers"

export type EvaluatorFailureMap = Map<string, Record<string, EvaluatorFailure>>

export const evaluatorFailuresMapFamily = atomFamily(
    (runId: string) =>
        atom((get) => {
            const scenarioIds = get(displayedScenarioIdsFamily(runId)) ?? []
            const result: EvaluatorFailureMap = new Map()

            scenarioIds.forEach((scenarioId) => {
                const loadable = get(loadableScenarioStepFamily({runId, scenarioId}))
                let data = loadable.state === "hasData" ? loadable.data : undefined
                if (!data) {
                    const local = get(scenarioStepLocalFamily({runId, scenarioId}))
                    if (local && Object.keys(local).length > 0) {
                        data = local
                    }
                }
                if (!data) return

                const failures: Record<string, EvaluatorFailure> = {}
                const handleStep = (step: any) => {
                    if (!step) return
                    const slugCandidate =
                        step?.annotation?.references?.evaluator?.slug ??
                        step?.references?.evaluator?.slug ??
                        step?.references?.application?.slug ??
                        step?.stepKey?.split?.(".")?.[0]
                    if (!slugCandidate || failures[slugCandidate]) return
                    if (hasFailureStatus(step?.status)) {
                        failures[slugCandidate] = {
                            status: step?.status,
                            error: resolveErrorMessage(step?.error),
                        }
                    }
                }

                const annotationSteps = Array.isArray(data.annotationSteps)
                    ? data.annotationSteps
                    : []
                annotationSteps.forEach(handleStep)

                const invocationSteps = Array.isArray(data.invocationSteps)
                    ? data.invocationSteps
                    : []
                invocationSteps.forEach(handleStep)

                const generalSteps = Array.isArray(data.steps) ? data.steps : []
                generalSteps.forEach(handleStep)

                if (Object.keys(failures).length) {
                    result.set(scenarioId, failures)
                }
            })

            return result
        }),
    deepEqual,
)
