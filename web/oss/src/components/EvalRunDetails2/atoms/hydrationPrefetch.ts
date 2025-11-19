import {atom} from "jotai"

import {evaluationAnnotationQueryAtomFamily} from "./annotations"
import {evaluationMetricQueryAtomFamily} from "./metrics"
import {scenarioStepsQueryFamily} from "./scenarioSteps"
import {evaluationTestcaseQueryAtomFamily} from "./table/testcases"
import {evaluationTraceQueryAtomFamily} from "./traces"

const getStepKind = (step: any) =>
    step?.kind ?? step?.type ?? step?.stepType ?? step?.step_type ?? undefined

const toTraceId = (step: any) => step?.traceId ?? step?.trace_id ?? step?.trace?.tree?.id
const toTestcaseId = (step: any) => step?.testcaseId ?? step?.testcase_id

interface PrimePayload {
    scenarioIds: string[]
}

export const primeScenarioHydrationAtom = atom<null, PrimePayload>(null, (get, _set, payload) => {
    const scenarioIds = Array.from(new Set(payload.scenarioIds.filter(Boolean)))
    if (scenarioIds.length === 0) return

    scenarioIds.forEach((scenarioId) => {
        const stepsResult = get(scenarioStepsQueryFamily({scenarioId, runId: undefined}))
        const steps = stepsResult.data?.steps ?? []
        const testcaseIds = new Set<string>()
        const traceIds = new Set<string>()
        const annotationTraceIds = new Set<string>()

        steps.forEach((step: any) => {
            const kind = getStepKind(step)
            if (kind === "input") {
                const testcaseId = toTestcaseId(step)
                if (testcaseId) testcaseIds.add(testcaseId)
            }
            if (kind === "invocation") {
                const traceId = toTraceId(step)
                if (traceId) traceIds.add(traceId)
            }
            if (kind === "annotation") {
                const traceId = toTraceId(step)
                if (traceId) annotationTraceIds.add(traceId)
            }
        })

        testcaseIds.forEach((testcaseId) => {
            get(evaluationTestcaseQueryAtomFamily({testcaseId, runId: undefined}))
        })

        traceIds.forEach((traceId) => {
            get(evaluationTraceQueryAtomFamily({traceId, runId: undefined}))
        })

        annotationTraceIds.forEach((traceId) => {
            get(evaluationAnnotationQueryAtomFamily({traceId, runId: undefined}))
        })

        get(evaluationMetricQueryAtomFamily({scenarioId, runId: undefined}))
    })
})
