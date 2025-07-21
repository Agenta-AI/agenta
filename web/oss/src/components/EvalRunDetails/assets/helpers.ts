import {AnnotationDto} from "@/oss/lib/hooks/useAnnotations/types"
import {createAnnotation, updateAnnotation} from "@/oss/services/annotations/api"

import {
    generateAnnotationPayloadData,
    generateNewAnnotationPayloadData,
} from "../../pages/observability/drawer/AnnotateDrawer/assets/transforms"

import {
    getScenario,
    buildAnnotationContext,
    partitionAnnotationResults,
    abortIfMissingMetrics,
    finalizeAnnotationSuccess,
    startOptimisticAnnotation,
    processAnnotationError,
    findAnnotationStepsFromPayload,
} from "./annotationUtils"

export const handleAnnotate = async ({
    runId,
    scenarioId,
    updatedMetrics,
    formatErrorMessages,
    setErrorMessages,
    projectId,
    stepKey,
}: {
    runId: string
    scenarioId: string
    updatedMetrics: Record<string, any>
    formatErrorMessages: (requiredMetrics: Record<string, any>) => void
    setErrorMessages: (errorMessages: string[]) => void
    projectId: string
    stepKey: string
}) => {
    const ctx = await buildAnnotationContext({scenarioId, stepKey})
    if (!ctx) return
    const {evaluators, stepData, traceSpanIds, testsetId, testcaseId, traceTree, jwt, apiUrl} = ctx

    if (!traceTree) {
        if (process.env.NODE_ENV !== "production") {
            console.debug("No trace found on invocation step", scenarioId)
        }
        return
    }

    const node = traceTree.nodes?.[0]

    if (!node) {
        if (process.env.NODE_ENV !== "production") {
            console.debug("No trace node found for scenario", scenarioId)
        }
        return
    }

    const params = {
        updatedMetrics,
        selectedEvaluators: evaluators.map((e) => e.slug),
        evaluators,
        traceSpanIds,
        testsetId,
        testcaseId,
    }

    const {payload, requiredMetrics} = generateNewAnnotationPayloadData({
        ...params,
        invocationStepKey: stepKey,
        testsetId,
        testcaseId,
    })

    if (abortIfMissingMetrics(requiredMetrics, formatErrorMessages)) return
    if (!payload.length) return

    const annotationSteps = findAnnotationStepsFromPayload(stepData?.annotationSteps, payload)

    if (!annotationSteps.length) {
        console.error("No annotation steps matched payload", {scenarioId, payload})
        throw new Error("Annotation step(s) not found")
    }

    try {
        // optimistic update for each matched step
        annotationSteps.forEach((st) => {
            startOptimisticAnnotation(scenarioId, st, apiUrl, jwt, projectId)
        })

        const annotationResults = await Promise.allSettled(
            payload.map((evaluatorPayload) => createAnnotation(evaluatorPayload)),
        )
        const {annotationResponses, evaluatorStatuses} = partitionAnnotationResults(
            annotationResults,
            payload,
        )

        await finalizeAnnotationSuccess({
            mode: "create",
            annotationResponses,
            evaluatorStatuses,
            stepData,
            stepKey,
            scenarioId,
            runId,
            projectId,
            scenario: getScenario(scenarioId),
            setErrorMessages,
            annotationSteps,
            jwt,
            apiUrl,
            evaluators,
        })
    } catch (err) {
        await processAnnotationError(
            scenarioId,
            err,
            annotationSteps,
            apiUrl,
            jwt,
            projectId,
            setErrorMessages,
        )
    }
}

export const handleUpdateAnnotate = async ({
    runId,
    scenarioId,
    updatedMetrics,
    formatErrorMessages,
    setErrorMessages,
    projectId,
    stepKey,
}: {
    runId: string
    scenarioId: string
    updatedMetrics: Record<string, any>
    formatErrorMessages: (requiredMetrics: Record<string, any>) => void
    setErrorMessages: (errorMessages: string[]) => void
    projectId: string
    stepKey: string
}) => {
    const ctx = await buildAnnotationContext({scenarioId, stepKey})
    if (!ctx) return
    const {evaluators, stepData, jwt, apiUrl} = ctx

    const allAnnotations = stepData?.annotationSteps?.map((s) => s.annotation).filter(Boolean) as AnnotationDto[]

    // Only use the new canonical payload generator
    const params = {
        updatedMetrics,
        selectedEvaluators: evaluators.map((e) => e.slug),
        evaluators,
        annotations: allAnnotations,
    }
    const {payload, requiredMetrics} = generateAnnotationPayloadData({
        ...params,
        invocationStepKey: stepKey,
    })

    if (abortIfMissingMetrics(requiredMetrics, formatErrorMessages)) return
    if (!payload.length) return

    const scenario = getScenario(scenarioId)
    const annotationSteps = findAnnotationStepsFromPayload(
        stepData?.annotationSteps,
        payload
            .map((p) => {
                const annotation = allAnnotations.find(
                    (a) => a.span_id === p.span_id && a.trace_id === p.trace_id,
                )
                return {
                    annotation,
                }
            })
            .filter(Boolean) as {annotation: AnnotationDto}[],
    )

    if (!annotationSteps.length) {
        console.error("No annotation steps matched payload", {scenarioId, payload})
        throw new Error("Annotation step(s) not found")
    }

    try {
        // 1. enabling annotating state
        annotationSteps.forEach((st) => {
            startOptimisticAnnotation(scenarioId, st, apiUrl, jwt, projectId)
        })

        // 2. updating annotations
        const annotationResults = await Promise.allSettled(
            payload.map((annotation) => {
                const {trace_id, span_id, ...rest} = annotation
                return updateAnnotation({
                    payload: rest,
                    traceId: trace_id || "",
                    spanId: span_id || "",
                })
            }),
        )
        const {annotationResponses, evaluatorStatuses} = partitionAnnotationResults(
            annotationResults,
            payload,
        )

        // 3. Optimistic update: mark as revalidating
        await finalizeAnnotationSuccess({
            mode: "update",
            annotationResponses,
            evaluatorStatuses,
            stepData,
            stepKey,
            scenarioId,
            runId,
            projectId,
            scenario,
            setErrorMessages,
            annotationSteps,
            jwt,
            apiUrl,
            evaluators,
        })
        setErrorMessages([])
    } catch (err) {
        await processAnnotationError(
            scenarioId,
            err,
            annotationSteps,
            apiUrl,
            jwt,
            projectId,
            setErrorMessages,
        )
    }
}

export const statusColorMap: Record<string, string> = {
    pending: "text-[#758391]",
    incomplete: "text-[#758391]",
    running: "text-[#758391]",
    done: "text-green-600",
    success: "text-green-600",
    failed: "text-red-500",
    error: "text-red-500",
    cancelled: "text-yellow-500",
}
