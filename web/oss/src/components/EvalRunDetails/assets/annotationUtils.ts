import {getCurrentProject} from "@/oss/contexts/project.context"
import axios from "@/oss/lib/api/assets/axiosConfig"
import {getAgentaApiUrl} from "@/oss/lib/helpers/utils"
import {uuidToSpanId, uuidToTraceId} from "@/oss/lib/hooks/useAnnotations/assets/helpers"
import {AnnotationDto} from "@/oss/lib/hooks/useAnnotations/types"
import {
    evalAtomStore,
    evaluationEvaluatorsAtom,
    evaluationRunStateAtom,
    revalidateScenario,
    scenarioStepFamily,
} from "@/oss/lib/hooks/useEvaluationRunData/assets/atoms"
import {IAnnotationStep, IStepResponse} from "@/oss/lib/hooks/useEvaluationRunScenarioSteps/types"
import {EvaluatorDto} from "@/oss/lib/hooks/useEvaluators/types"
import {EvaluationStatus} from "@/oss/lib/Types"
import {getJWT} from "@/oss/services/api"
import {updateScenarioStatusRemote} from "@/oss/services/evaluations/workerUtils"
import {createScenarioMetrics} from "@/oss/services/runMetrics/api"

import {setOptimisticStepData} from "./optimisticUtils"
import {collectStepsAndMetrics} from "./stepsMetricsUtils"

/**
 * Retrieve the scenario object (if present) for the given id.
 */
export const getScenario = (scenarioId: string) => {
    return (
        evalAtomStore()
            .get(evaluationRunStateAtom)
            ?.scenarios?.find((s) => s.id === scenarioId) || null
    )
}

/**
 * Retrieve the evaluators associated with the current evaluation run.
 */
export const getEvaluators = () => {
    return evalAtomStore().get(evaluationEvaluatorsAtom)
}

/**
 * Lazily load step data for a scenario via the jotai family.
 */
export const getStepData = async (scenarioId: string) => {
    return await evalAtomStore().get(scenarioStepFamily(scenarioId))
}

/**
 * Utility that checks the `requiredMetrics` object returned by payload generation.
 * If any metric is missing it will call the provided formatter and returns `false`. Otherwise returns `true`.
 */
export const validateRequiredMetrics = (
    requiredMetrics: Record<string, unknown>,
    formatErrorMessages: (requiredMetrics: Record<string, any>) => void,
): boolean => {
    const hasMissing = Object.keys(requiredMetrics || {}).length > 0
    if (hasMissing) {
        formatErrorMessages(requiredMetrics)
    }
    return !hasMissing
}

// ----------------------------------
// Backend synchronisation utilities
// ----------------------------------

interface PushStepsAndMetricsParams {
    patchStepsFull: any[]
    stepsToCreate?: any[]
    metricEntries: {scenarioId: string; data: Record<string, number>}[]
    projectId: string
    runId: string
}

export const pushStepsAndMetrics = async ({
    patchStepsFull,
    stepsToCreate = [],
    metricEntries,
    projectId,
    runId,
}: PushStepsAndMetricsParams) => {
    if (patchStepsFull.length) {
        await axios.patch(`/preview/evaluations/steps/?project_id=${projectId}`, {
            steps: patchStepsFull,
        })
    }
    if (stepsToCreate.length) {
        await axios.post(`/preview/evaluations/steps/?project_id=${projectId}`, {
            steps: stepsToCreate,
        })
    }
    if (metricEntries.length) {
        const jwt = await getJWT()
        if (jwt) {
            await createScenarioMetrics(getAgentaApiUrl(), jwt, runId, metricEntries, projectId)
        }
    }
}

/**
 * Triggers revalidation for a single scenario and cleans up optimistic overrides once fresh data arrives.
 */
/**
 * Partitions Promise.allSettled results into successful responses and builds evaluator status map
 */
export const partitionAnnotationResults = (
    annotationResults: PromiseSettledResult<any>[],
    payload: any[],
): {annotationResponses: any[]; evaluatorStatuses: Record<string, string>} => {
    const fulfilled = annotationResults.filter(
        (r): r is PromiseFulfilledResult<any> => r.status === "fulfilled",
    )
    const annotationResponses = fulfilled.map((f) => f.value)
    const evaluatorStatuses: Record<string, string> = {}
    annotationResults.forEach((result, idx) => {
        const slug = payload[idx]?.annotation?.references?.evaluator?.slug
        if (!slug) return
        evaluatorStatuses[slug] =
            result.status === "fulfilled" ? EvaluationStatus.SUCCESS : EvaluationStatus.FAILURE
    })
    return {annotationResponses, evaluatorStatuses}
}

/**
 * Returns true if metrics are missing and the caller should abort.
 */
export const abortIfMissingMetrics = (
    requiredMetrics: Record<string, unknown> | undefined,
    formatErrorMessages: (metrics: any) => void,
): boolean => {
    if (requiredMetrics && Object.keys(requiredMetrics).length > 0) {
        formatErrorMessages(requiredMetrics)
        return true
    }
    return false
}

/**
 * Handles backend sync and scenario status updates after annotation succeeds
 */
export const startOptimisticAnnotation = async (
    scenarioId: string,
    step: IAnnotationStep,
    apiUrl: string,
    jwt: string,
    projectId: string,
) => {
    setOptimisticStepData(scenarioId, [
        {
            ...structuredClone(step),
            status: "annotating",
        },
    ])
    updateScenarioStatusRemote(apiUrl, jwt, scenarioId, EvaluationStatus.RUNNING, projectId)
}

/**
 * Build common annotation context (evaluators, trace ids, testset ids, etc.)
 */
export const buildAnnotationContext = async ({
    scenarioId,
    stepKey,
}: {
    scenarioId: string
    stepKey: string
}) => {
    const evaluators = getEvaluators()
    const testsets = evalAtomStore().get(evaluationRunStateAtom)?.enrichedRun?.testsets
    const stepData = await getStepData(scenarioId)
    const jwt = await getJWT()
    const projectId = getCurrentProject()?.projectId

    const invocationStep = stepData?.invocationSteps?.find((s: any) => s.key === stepKey)
    if (!invocationStep) return null

    const traceTree = (invocationStep as any)?.trace
    if (!traceTree) return null

    const node = traceTree.nodes?.[0]
    if (!node) return null

    const traceSpanIds = {
        spanId: uuidToSpanId(node.node.id) as string,
        traceId: uuidToTraceId(node.root.id) as string,
    }

    const testcaseId = invocationStep.testcaseId
    const testsetId = testsets?.find((s: any) => s.data?.testcase_ids?.includes(testcaseId))?.id

    return {
        evaluators,
        jwt,
        projectId,
        stepData,
        traceSpanIds,
        testsetId,
        testcaseId,
        invocationStep,
        traceTree,
        apiUrl: getAgentaApiUrl(),
    }
}

export const processAnnotationError = async (
    scenarioId: string,
    err: unknown,
    annotationSteps: IAnnotationStep[],
    apiUrl: string,
    jwt: string,
    projectId: string,
    setErrorMessages: (msgs: string[]) => void,
) => {
    setErrorMessages([(err as Error).message])
    setOptimisticStepData(
        scenarioId,
        annotationSteps.map((st) => ({
            ...structuredClone(st),
            status: EvaluationStatus.ERROR,
        })),
    )
    // await updateScenarioStatus(scenario, finalStatus)
    updateScenarioStatusRemote(apiUrl, jwt, scenarioId, EvaluationStatus.ERROR, projectId)
}

export const finalizeAnnotationSuccess = async ({
    annotationSteps,
    mode,
    annotationResponses,
    evaluatorStatuses,
    stepData,
    stepKey,
    scenarioId,
    runId,
    projectId,
    scenario,
    jwt,
    apiUrl,
    evaluators,
    setErrorMessages,
}: {
    annotationSteps: IAnnotationStep[]
    mode: "create" | "update"
    annotationResponses: any[]
    evaluatorStatuses: Record<string, string>
    stepData: any
    stepKey: string
    scenarioId: string
    runId: string
    projectId: string
    jwt: string
    apiUrl: string
    scenario: any
    evaluators: EvaluatorDto[]
    setErrorMessages: (val: any[]) => void
}) => {
    if (!annotationResponses.length) return

    const {stepsToCreate, patchStepsFull, metricEntries} = collectStepsAndMetrics({
        mode,
        annotationResponses,
        stepData,
        stepKey,
        evaluatorStatuses,
        scenarioId,
        runId,
        evaluators,
    })

    await pushStepsAndMetrics({
        patchStepsFull,
        stepsToCreate,
        metricEntries,
        projectId,
        runId,
    })

    updateScenarioStatusRemote(apiUrl, jwt, scenarioId, EvaluationStatus.SUCCESS, projectId)
    await triggerScenarioRevalidation(
        scenarioId,
        annotationSteps.map((st) => ({
            ...structuredClone(st),
            status: "revalidating",
        })),
    )

    setErrorMessages([])
}

export const triggerScenarioRevalidation = async (
    scenarioId: string,
    updatedSteps?: IStepResponse[],
) => {
    try {
        await revalidateScenario(scenarioId, updatedSteps)
    } catch (err) {
        console.error("Failed to revalidate scenario", err)
    }
}

/** Return all annotationSteps that match any item in the payload */
export const findAnnotationStepsFromPayload = (
    annotationSteps: IAnnotationStep[] = [],
    payload: {annotation: AnnotationDto}[],
) => {
    if (!annotationSteps.length || !payload.length) return []

    return annotationSteps.filter((step) =>
        payload.some(({annotation}) => {
            const evaluatorSlug = annotation.references?.evaluator?.slug
            const linkKeys = annotation.links ? Object.keys(annotation.links) : []
            if (!evaluatorSlug || !linkKeys.length) return false

            // backend guarantees first (and usually only) link key is the invocation key
            const invocationKey = linkKeys[0] // e.g. "default-2cd951533447"
            const expectedStepKey = `${invocationKey}.${evaluatorSlug}`

            return step.key === expectedStepKey
        }),
    )
}
