import {EvaluatorDto} from "@/oss/lib/hooks/useEvaluators/types"
import {EvaluationStatus} from "@/oss/lib/Types"
import {computeRunMetrics} from "@/oss/services/runMetrics/api"

export interface StepsAndMetricsResult {
    stepsToCreate: any[]
    patchStepsFull: any[]
    metricEntries: {scenarioId: string; data: Record<string, any>}[]
}

interface CollectParams {
    mode: "create" | "update"
    annotationResponses: any[]
    stepData: any
    stepKey: string
    evaluatorStatuses?: Record<string, string>
    scenarioId: string
    runId: string
    evaluators: EvaluatorDto[]
}

/**
 * Consolidated logic used by both handleAnnotate (create) and handleUpdateAnnotate (update)
 * to build arrays for step PATCH/POST and metric creation.
 */
export const collectStepsAndMetrics = ({
    mode,
    annotationResponses,
    stepData,
    stepKey,
    evaluatorStatuses = {},
    scenarioId,
    runId,
    evaluators,
}: CollectParams): StepsAndMetricsResult => {
    const patchStepsFull: any[] = []
    const stepsToCreate: any[] = []
    const nestedMetrics: Record<string, Record<string, any>> = {}

    // Filter annotation steps belonging to the selected invocation step
    const stepAnnotationSteps = (stepData.annotationSteps || []).filter((ann: any) =>
        (ann.stepKey ?? "").startsWith(`${stepKey}.`),
    )

    if (mode === "create") {
        // Track existing keys to avoid duplicates
        const existingStepKeys = new Set(stepAnnotationSteps.map((s: any) => s.stepKey))

        annotationResponses.forEach((resp: any) => {
            const ann = resp?.data?.annotation
            if (!ann) return
            const slug = ann.references?.evaluator?.slug
            const evaluatorKey = `${stepKey}.${slug}`
            const status = evaluatorStatuses[slug] || EvaluationStatus.SUCCESS

            const evaluator = evaluators.find((e) => e.slug === slug)
            if (!evaluator) return

            const metricSchema = evaluator?.data.service.format.properties.outputs.properties
            // Add to creation list if not already existing
            if (!existingStepKeys.has(evaluatorKey)) {
                stepsToCreate.push({
                    status,
                    step_key: evaluatorKey,
                    span_id: ann.span_id,
                    trace_id: ann.trace_id,
                    scenario_id: scenarioId,
                    run_id: runId,
                })
            }

            // Collect metric outputs into nested structure keyed by invocation+evaluator
            const outputs = ann.data?.outputs || {}
            const fullKey = slug ? `${stepKey}.${slug}` : stepKey
            const computed = computeRunMetrics([{data: outputs}])

            if (!nestedMetrics[fullKey]) nestedMetrics[fullKey] = {}
            Object.entries(computed).forEach(([k, v]) => {
                const stat = structuredClone(v)
                const schema = metricSchema[k]
                if (schema?.type === "boolean") {
                    stat.value = stat.unique?.[0]
                } else if (schema?.type === "array") {
                    stat.value = stat.unique
                } else if (schema?.type === "string") {
                    stat.value = stat.unique
                } else if ("anyOf" in schema) {
                    stat.value = stat.unique.length > 1 ? stat.unique : stat.unique[0]
                }
                // else if (schema?.type === "number") {
                //     stat.value = stat.mean
                // }
                if ("distribution" in stat) delete stat.distribution
                if ("percentiles" in stat) delete stat.percentiles
                if ("iqrs" in stat) delete stat.iqrs
                if ("frequency" in stat) delete stat.frequency
                if ("rank" in stat) delete stat.rank
                if ("unique" in stat) delete stat.unique
                if ("binSize" in stat) delete stat.binSize

                nestedMetrics[fullKey][k] = stat
            })
        })

        // Build patch list by aligning responses to existing steps
        stepAnnotationSteps.forEach((ann: any) => {
            const linkedResponse = annotationResponses.find((r) => {
                const annKey = `${stepKey}.${r?.data?.annotation?.references?.evaluator?.slug}`
                return annKey === ann.stepKey
            })
            if (linkedResponse) {
                const status =
                    evaluatorStatuses[ann.stepKey.split(".")[1]] || EvaluationStatus.SUCCESS
                patchStepsFull.push({
                    ...ann,
                    status,
                    trace_id: linkedResponse.data.annotation.trace_id,
                    span_id: linkedResponse.data.annotation.span_id,
                })
            } else {
                patchStepsFull.push(ann)
            }
        })
    } else {
        // UPDATE flow: only patch existing steps, no creations
        stepAnnotationSteps.forEach((ann: any) => {
            const linkedResponse = annotationResponses.find(
                (r) =>
                    r?.data?.annotation?.span_id === ann.annotation?.span_id &&
                    r?.data?.annotation?.trace_id === ann.annotation?.trace_id,
            )
            if (!linkedResponse) return

            const slug = ann.stepKey.split(".")[1]
            const evaluator = evaluators.find((e) => e.slug === slug)
            if (!evaluator) return

            const metricSchema = evaluator?.data.service.format.properties.outputs.properties

            patchStepsFull.push({
                ...ann,
                trace_id: linkedResponse?.data?.annotation?.trace_id,
                span_id: linkedResponse?.data?.annotation?.span_id,
            })

            const outputs = linkedResponse?.data?.annotation?.data?.outputs || {}
            const computed = computeRunMetrics([{data: outputs}])

            const fullKey = `${stepKey}.${slug}`
            if (!nestedMetrics[fullKey]) nestedMetrics[fullKey] = {}
            Object.entries(computed).forEach(([k, v]) => {
                const stat = structuredClone(v)
                if (metricSchema?.[k]?.type === "boolean") {
                    stat.value = v.unique?.[0]
                } else if (metricSchema?.[k]?.type === "array") {
                    stat.value = stat.unique
                } else if (metricSchema?.[k]?.type === "string") {
                    stat.value = stat.unique
                } else if ("anyOf" in metricSchema[k]) {
                    stat.value = stat.unique?.length > 1 ? stat.unique : stat.unique[0]
                }

                if ("distribution" in stat) delete stat.distribution
                if ("percentiles" in stat) delete stat.percentiles
                if ("iqrs" in stat) delete stat.iqrs
                if ("frequency" in stat) delete stat.frequency
                if ("rank" in stat) delete stat.rank
                if ("unique" in stat) delete stat.unique
                nestedMetrics[fullKey][k] = stat
            })
        })
    }

    const metricEntries: {scenarioId: string; data: Record<string, any>}[] = []
    if (Object.keys(nestedMetrics).length > 0) {
        metricEntries.push({scenarioId, data: nestedMetrics})
    }

    return {stepsToCreate, patchStepsFull, metricEntries}
}
