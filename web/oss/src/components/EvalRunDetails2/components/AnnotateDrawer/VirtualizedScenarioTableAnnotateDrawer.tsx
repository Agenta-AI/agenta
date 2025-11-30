import {memo, useCallback, useEffect, useMemo, useRef, useState} from "react"

import {Button, DrawerProps, Spin} from "antd"
import deepEqual from "fast-deep-equal"
import {getDefaultStore, useAtomValue, useSetAtom} from "jotai"
import dynamic from "next/dynamic"

import {message} from "@/oss/components/AppMessageContext"
import EnhancedDrawer from "@/oss/components/EnhancedUIs/Drawer"
import {
    generateAnnotationPayloadData,
    generateNewAnnotationPayloadData,
    getInitialMetricsFromAnnotations,
} from "@/oss/components/pages/observability/drawer/AnnotateDrawer/assets/transforms"
import type {UpdatedMetricsType} from "@/oss/components/pages/observability/drawer/AnnotateDrawer/assets/types"
import {virtualScenarioTableAnnotateDrawerAtom} from "@/oss/lib/atoms/virtualTable"
import {uuidToSpanId} from "@/oss/lib/traces/helpers"
import {createAnnotation, updateAnnotation} from "@/oss/services/annotations/api"
import {upsertStepResultWithAnnotation} from "@/oss/services/evaluations/results/api"
import {upsertScenarioMetricData} from "@/oss/services/runMetrics/api"

import {
    invalidateAnnotationBatcherCache,
    scenarioAnnotationsQueryAtomFamily,
} from "../../atoms/annotations"
import {evaluationMetricQueryAtomFamily, invalidateMetricBatcherCache} from "../../atoms/metrics"
import {invalidatePreviewRunMetricStatsAtom} from "../../atoms/runMetrics"
import {
    invalidateScenarioStepsBatcherCache,
    scenarioStepsQueryFamily,
} from "../../atoms/scenarioSteps"
import {evaluationEvaluatorsByRunQueryAtomFamily} from "../../atoms/table/evaluators"
import {buildScenarioMetricDataFromAnnotation} from "../../utils/buildAnnotationMetricData"
import {classifyStep} from "../views/SingleScenarioViewerPOC"

const Annotate = dynamic(
    () =>
        import(
            "@agenta/oss/src/components/pages/observability/drawer/AnnotateDrawer/assets/Annotate"
        ),
    {ssr: false},
)

const EMPTY_ARRAY: any[] = []

interface AnnotateActionState {
    canSubmit: boolean
    isSubmitting: boolean
}

const PreviewAnnotateContent = ({
    scenarioId,
    runId,
    onClose,
    onStateChange,
    registerSubmit,
}: {
    scenarioId: string
    runId: string
    onClose: () => void
    onStateChange?: (state: AnnotateActionState) => void
    registerSubmit?: (handler: () => Promise<void>) => void
}) => {
    const stepsQuery = useAtomValue(
        useMemo(() => scenarioStepsQueryFamily({scenarioId, runId}), [scenarioId, runId]),
    )

    // Invalidate run-level metric stats after annotation updates
    const invalidateRunMetricStats = useSetAtom(invalidatePreviewRunMetricStatsAtom)

    const stepsLoading = stepsQuery?.isLoading || stepsQuery?.isFetching

    const invocationSteps = useMemo(() => {
        const steps = stepsQuery?.data?.steps ?? stepsQuery?.data?.invocationSteps ?? []
        return steps.filter((step: any) => classifyStep(step) === "invocation")
    }, [stepsQuery?.data?.steps, stepsQuery?.data?.invocationSteps])

    // Build a map from evaluator slug to existing annotation step key
    // This is needed to UPDATE existing step results instead of creating duplicates
    const annotationStepKeyBySlug = useMemo(() => {
        const map = new Map<string, string>()
        const steps = stepsQuery?.data?.steps ?? []
        steps.forEach((step: any) => {
            if (classifyStep(step) !== "annotation") return
            const stepKey = step?.stepKey ?? step?.step_key ?? step?.key
            if (!stepKey) return
            // Extract evaluator slug from step key (format: "prefix.evaluator-slug")
            const parts = stepKey.split(".")
            const slug = parts.length > 1 ? parts[parts.length - 1] : null
            if (slug) {
                map.set(slug, stepKey)
            }
        })
        return map
    }, [stepsQuery?.data?.steps])

    const extractOutputs = useCallback(
        (step: any) =>
            step?.outputs ??
            step?.output ??
            step?.response ??
            step?.result ??
            step?.data?.outputs ??
            step?.data?.output ??
            step?.payload?.outputs ??
            step?.payload?.output ??
            null,
        [],
    )

    // Collect trace IDs from both invocation steps AND annotation steps
    // Annotation steps have their own trace_ids that link to the annotation data
    const traceIds = useMemo(() => {
        const allSteps = stepsQuery?.data?.steps ?? []
        const ids = new Set<string>()

        // Add trace IDs from invocation steps
        invocationSteps.forEach((step: any) => {
            const traceId = step?.traceId || step?.trace_id
            if (traceId) ids.add(traceId)
        })

        // Add trace IDs from annotation steps (these link to the actual annotations)
        allSteps.forEach((step: any) => {
            if (classifyStep(step) !== "annotation") return
            const traceId = step?.traceId || step?.trace_id
            if (traceId) ids.add(traceId)
        })

        return Array.from(ids)
    }, [invocationSteps, stepsQuery?.data?.steps])
    const traceIdsKey = useMemo(() => traceIds.join("|"), [traceIds])

    const annotationsQuery = useAtomValue(
        useMemo(() => scenarioAnnotationsQueryAtomFamily({traceIds, runId}), [traceIdsKey, runId]),
    )

    const metricsQuery = useAtomValue(
        useMemo(() => evaluationMetricQueryAtomFamily({scenarioId, runId}), [scenarioId, runId]),
    )

    const evaluatorQuery = useAtomValue(
        useMemo(() => evaluationEvaluatorsByRunQueryAtomFamily(runId ?? null), [runId]),
    )

    const evaluatorDtos = useMemo(() => {
        const list = (evaluatorQuery?.data || EMPTY_ARRAY) as any[]
        return list.map((e: any) => e?.raw ?? e).filter(Boolean)
    }, [evaluatorQuery])

    const existingAnnotations = annotationsQuery?.data?.length
        ? annotationsQuery.data
        : (stepsQuery?.data?.annotationSteps ?? []).map(
              (step: any) => step?.annotation ?? step?.data?.annotations,
          )

    const combinedAnnotations = useMemo(() => {
        const bySlug = new Map<string, any>()
        ;(existingAnnotations ?? []).forEach((ann: any) => {
            const slug = ann?.references?.evaluator?.slug
            if (slug) bySlug.set(slug, ann)
        })
        return Array.from(bySlug.values())
    }, [existingAnnotations])

    const annotatedSlugs = useMemo(() => {
        const slugs = new Set<string>()
        combinedAnnotations?.forEach((ann: any) => {
            const slug = ann?.references?.evaluator?.slug
            if (slug) slugs.add(slug)
        })
        return slugs
    }, [combinedAnnotations])

    const [annotationMetrics, setAnnotationMetrics] = useState<UpdatedMetricsType>({})
    const [tempSelectedEvaluators, setTempSelectedEvaluators] = useState<string[]>([])
    const [errorMessage, setErrorMessage] = useState<string[]>([])
    const [isSubmitting, setIsSubmitting] = useState(false)

    const annotationsForAnnotate = useMemo(
        () => [...(combinedAnnotations ?? [])],
        [combinedAnnotations],
    )

    const selectedEvaluators = useMemo(
        () =>
            evaluatorDtos
                .map((e: any) => e.slug)
                .filter((slug: any) => Boolean(slug) && !annotatedSlugs.has(slug)),
        [evaluatorDtos, annotatedSlugs],
    )

    const baselineMetrics = useMemo(() => {
        try {
            return getInitialMetricsFromAnnotations({
                annotations: combinedAnnotations ?? [],
                evaluators: evaluatorDtos as any[],
            })
        } catch {
            return {}
        }
    }, [combinedAnnotations, evaluatorDtos])

    useEffect(() => {
        if (!combinedAnnotations?.length) return
        if (!baselineMetrics || Object.keys(baselineMetrics).length === 0) return
        setAnnotationMetrics((prev) => {
            if (prev && Object.keys(prev).length > 0) return prev
            return baselineMetrics as UpdatedMetricsType
        })
    }, [combinedAnnotations, baselineMetrics])

    const hasPendingAnnotationChanges = useMemo(() => {
        if (!annotationMetrics || Object.keys(annotationMetrics).length === 0) return false
        return Object.entries(annotationMetrics).some(([slug, fields]) => {
            const baseline = (baselineMetrics as any)?.[slug] || {}
            return Object.entries(fields || {}).some(([key, field]) => {
                const nextVal = (field as any)?.value
                const prevVal = (baseline as any)?.[key]?.value
                return !deepEqual(prevVal, nextVal)
            })
        })
    }, [annotationMetrics, baselineMetrics])

    const hasInvocationOutput =
        invocationSteps.some((step) => Boolean(extractOutputs(step))) || traceIds.length > 0

    const hasNewAnnotationMetrics = useMemo(
        () =>
            selectedEvaluators.some((slug) => {
                const fields = annotationMetrics?.[slug]
                if (!fields || Object.keys(fields).length === 0) return false
                return Object.values(fields).some((field: any) => {
                    const val = field?.value
                    if (Array.isArray(val)) return val.length > 0
                    return val !== undefined && val !== null && val !== ""
                })
            }),
        [annotationMetrics, selectedEvaluators],
    )

    const primaryInvocation = invocationSteps[0]

    // Find the step that has a trace_id - this is the one we should link annotations to
    // This might be different from primaryInvocation (e.g., "default-xxx" vs "norway-xxx")
    const stepWithTraceId = useMemo(() => {
        const allSteps = stepsQuery?.data?.steps ?? []
        // First, try to find an invocation step with a trace_id
        const invocationWithTrace = invocationSteps.find(
            (step: any) => step?.traceId || step?.trace_id,
        )
        if (invocationWithTrace) return invocationWithTrace

        // If no invocation step has a trace_id, look for any step with a trace_id
        // that is not an annotation step (annotation steps have their own trace_ids)
        const nonAnnotationWithTrace = allSteps.find((step: any) => {
            if (classifyStep(step) === "annotation") return false
            return step?.traceId || step?.trace_id
        })
        return nonAnnotationWithTrace ?? primaryInvocation
    }, [invocationSteps, stepsQuery?.data?.steps, primaryInvocation])

    const traceSpanIds = useMemo(() => {
        const annotationTrace = combinedAnnotations?.[0]?.trace_id
        const annotationSpan =
            combinedAnnotations?.[0]?.span_id ??
            combinedAnnotations?.[0]?.links?.invocation?.span_id

        // Use the step with trace_id for linking
        const sourceStep = stepWithTraceId ?? primaryInvocation

        const resolvedTraceId =
            sourceStep?.traceId ?? sourceStep?.trace_id ?? annotationTrace ?? traceIds[0] ?? ""

        // Try to get span_id from the step, or derive it from the trace_id
        const resolvedSpanId =
            sourceStep?.spanId ??
            sourceStep?.span_id ??
            (combinedAnnotations?.[0]?.links as any)?.invocation?.span_id ??
            annotationSpan ??
            // Derive span_id from trace_id if not available
            (resolvedTraceId ? uuidToSpanId(resolvedTraceId) : undefined)

        return {
            traceId: resolvedTraceId,
            spanId: resolvedSpanId,
        }
    }, [combinedAnnotations, stepWithTraceId, primaryInvocation, traceIds])

    // Use the step key from the step that has the trace_id for linking
    const invocationStepKey = useMemo(
        () =>
            stepWithTraceId?.stepKey ??
            stepWithTraceId?.step_key ??
            stepWithTraceId?.key ??
            primaryInvocation?.stepKey ??
            primaryInvocation?.step_key ??
            primaryInvocation?.key ??
            "",
        [stepWithTraceId, primaryInvocation],
    )

    const testcaseId =
        (primaryInvocation as any)?.testcaseId ??
        (primaryInvocation as any)?.testcase_id ??
        (primaryInvocation as any)?.testcase?.id
    const testsetId =
        (primaryInvocation as any)?.testsetId ??
        (primaryInvocation as any)?.testset_id ??
        (primaryInvocation as any)?.testset?.id

    const canSubmitAnnotations =
        !!traceSpanIds.traceId &&
        hasInvocationOutput &&
        (hasPendingAnnotationChanges || hasNewAnnotationMetrics)

    const handleAnnotate = useCallback(async () => {
        if (!canSubmitAnnotations) return

        setIsSubmitting(true)
        setErrorMessage([])

        try {
            const {payload: updatePayload, requiredMetrics: requiredExisting} =
                generateAnnotationPayloadData({
                    annotations: (combinedAnnotations as any[]) ?? [],
                    updatedMetrics: annotationMetrics,
                    evaluators: evaluatorDtos as any[],
                    invocationStepKey,
                    testsetId,
                    testcaseId,
                })

            const {payload: newPayload, requiredMetrics: requiredNew} =
                generateNewAnnotationPayloadData({
                    updatedMetrics: annotationMetrics,
                    selectedEvaluators,
                    evaluators: evaluatorDtos as any[],
                    traceSpanIds,
                    invocationStepKey,
                    testsetId,
                    testcaseId,
                })

            const requiredMetrics = {...requiredExisting, ...requiredNew}
            if (Object.keys(requiredMetrics).length > 0) {
                const errors = Object.entries(requiredMetrics).map(([key, data]) => {
                    const val = (data as any)?.value
                    const type = (data as any)?.type
                    return `Value ${val === "" ? "empty string" : val} is not assignable to type ${type} in ${key}`
                })
                setErrorMessage(errors)
                return
            }

            // Track annotation requests with their evaluator slugs for step result updates
            const updateRequests: {
                promise: Promise<any>
                slug: string
                traceId: string
                spanId: string
                isNew: false
            }[] = []
            const createRequests: {
                promise: Promise<any>
                slug: string
                isNew: true
            }[] = []

            updatePayload.forEach((entry) => {
                const traceId = entry.trace_id || traceSpanIds.traceId
                // Validate span_id - "missing" is an invalid placeholder that shouldn't be used
                const isValidSpanId = (id: string | undefined) =>
                    id && id !== "missing" && id.length > 0
                const spanId = isValidSpanId(entry.span_id)
                    ? entry.span_id
                    : isValidSpanId(traceSpanIds.spanId)
                      ? traceSpanIds.spanId
                      : // Derive span_id from trace_id as last resort
                        uuidToSpanId(traceId)
                if (!traceId || !spanId) return

                // Find the evaluator slug for this annotation by matching trace_id AND span_id
                const ann = combinedAnnotations.find(
                    (a: any) =>
                        (a.trace_id === entry.trace_id && a.span_id === entry.span_id) ||
                        (a.trace_id === traceId && a.span_id === spanId),
                )
                const slug = ann?.references?.evaluator?.slug || ""

                if (!slug) {
                    console.warn(
                        "[VirtualizedScenarioTableAnnotateDrawer] Could not find evaluator slug for annotation",
                        {traceId, spanId, entry},
                    )
                }

                updateRequests.push({
                    promise: updateAnnotation({
                        payload: {annotation: entry.annotation},
                        traceId,
                        spanId,
                    }),
                    slug,
                    traceId,
                    spanId,
                    isNew: false,
                })
            })

            newPayload.forEach((entry) => {
                const slug = (entry as any)?.annotation?.references?.evaluator?.slug || ""
                createRequests.push({
                    promise: createAnnotation(entry as any),
                    slug,
                    isNew: true,
                })
            })

            if (!updateRequests.length && !createRequests.length) {
                message.info("No annotation changes to submit")
                return
            }

            // Execute all annotation requests
            const allRequests = [...updateRequests, ...createRequests]

            console.info(
                "[VirtualizedScenarioTableAnnotateDrawer] Submitting annotation requests",
                {
                    updateCount: updateRequests.length,
                    createCount: createRequests.length,
                    updateSlugs: updateRequests.map((r) => r.slug),
                    createSlugs: createRequests.map((r) => r.slug),
                },
            )

            const responses = await Promise.all(allRequests.map((r) => r.promise))

            // Update step results with annotation references for new annotations
            // This links the annotation trace/span to the step result so string metrics can be displayed
            try {
                const stepResultUpdates: Promise<void>[] = []

                responses.forEach((response, index) => {
                    const request = allRequests[index]
                    if (!request.slug || !invocationStepKey) return

                    // For new annotations, get the trace/span from the response
                    // For updates, use the existing trace/span
                    let annotationTraceId: string | undefined
                    let annotationSpanId: string | undefined

                    if (request.isNew) {
                        // Response from createAnnotation contains the annotation data
                        const annData = response?.data?.annotation || response?.data
                        annotationTraceId = annData?.trace_id || annData?.traceId
                        annotationSpanId = annData?.span_id || annData?.spanId

                        console.info(
                            "[VirtualizedScenarioTableAnnotateDrawer] New annotation response",
                            {
                                slug: request.slug,
                                responseData: response?.data,
                                annData,
                                annotationTraceId,
                                annotationSpanId,
                            },
                        )
                    } else {
                        // For updates, use the existing trace/span IDs
                        annotationTraceId = request.traceId
                        annotationSpanId = request.spanId
                    }

                    if (annotationTraceId && annotationSpanId) {
                        // Use existing step key if available, otherwise construct new one
                        // This prevents creating duplicate step results when updating existing annotations
                        const existingStepKey = annotationStepKeyBySlug.get(request.slug)
                        const annotationStepKey =
                            existingStepKey ?? `${invocationStepKey}.${request.slug}`
                        console.info(
                            "[VirtualizedScenarioTableAnnotateDrawer] Updating step result",
                            {
                                stepKey: annotationStepKey,
                                existingStepKey,
                                constructedStepKey: `${invocationStepKey}.${request.slug}`,
                                annotationTraceId,
                                annotationSpanId,
                            },
                        )
                        stepResultUpdates.push(
                            upsertStepResultWithAnnotation({
                                runId,
                                scenarioId,
                                stepKey: annotationStepKey,
                                annotationTraceId,
                                annotationSpanId,
                                status: "success",
                            }),
                        )
                    } else {
                        console.warn(
                            "[VirtualizedScenarioTableAnnotateDrawer] Missing trace/span IDs for step result update",
                            {
                                slug: request.slug,
                                annotationTraceId,
                                annotationSpanId,
                                isNew: request.isNew,
                            },
                        )
                    }
                })

                if (stepResultUpdates.length > 0) {
                    await Promise.all(stepResultUpdates)
                    console.info(
                        "[VirtualizedScenarioTableAnnotateDrawer] Step results updated with annotation references",
                        {scenarioId, runId, count: stepResultUpdates.length},
                    )
                }
            } catch (stepError) {
                console.warn(
                    "[VirtualizedScenarioTableAnnotateDrawer] Failed to update step results",
                    stepError,
                )
            }

            // Build and save scenario metrics from the annotation data
            try {
                // Collect all metric data from updated annotations
                let allMetricData: Record<string, Record<string, unknown>> = {}

                // Process updated annotations (existing evaluators)
                for (const ann of combinedAnnotations) {
                    const slug = ann?.references?.evaluator?.slug
                    const updatedMetric = annotationMetrics[slug]
                    if (!slug || !updatedMetric) continue

                    // Build the outputs object from the updated metrics
                    const outputs: Record<string, unknown> = {}
                    for (const [key, property] of Object.entries(updatedMetric)) {
                        const value = (property as any)?.value
                        if (value !== undefined && value !== null && value !== "") {
                            outputs[key] = value
                        }
                    }

                    if (Object.keys(outputs).length > 0) {
                        const metricData = buildScenarioMetricDataFromAnnotation({
                            outputs,
                            invocationStepKey,
                            evaluatorSlug: slug,
                        })
                        allMetricData = {...allMetricData, ...metricData}
                    }
                }

                // Process new annotations (newly selected evaluators)
                for (const slug of selectedEvaluators) {
                    const updatedMetric = annotationMetrics[slug]
                    if (!updatedMetric) continue

                    // Build the outputs object from the updated metrics
                    const outputs: Record<string, unknown> = {}
                    for (const [key, property] of Object.entries(updatedMetric)) {
                        const value = (property as any)?.value
                        if (value !== undefined && value !== null && value !== "") {
                            outputs[key] = value
                        }
                    }

                    if (Object.keys(outputs).length > 0) {
                        const metricData = buildScenarioMetricDataFromAnnotation({
                            outputs,
                            invocationStepKey,
                            evaluatorSlug: slug,
                        })
                        allMetricData = {...allMetricData, ...metricData}
                    }
                }

                // Save the metrics if we have any
                if (Object.keys(allMetricData).length > 0) {
                    await upsertScenarioMetricData({
                        runId,
                        scenarioId,
                        data: allMetricData,
                    })
                    console.info(
                        "[VirtualizedScenarioTableAnnotateDrawer] Scenario metrics updated",
                        {
                            scenarioId,
                            runId,
                            metricData: allMetricData,
                        },
                    )
                }
            } catch (metricError) {
                // Log but don't fail the annotation if metric update fails
                console.warn(
                    "[VirtualizedScenarioTableAnnotateDrawer] Failed to update scenario metrics",
                    metricError,
                )
            }

            message.success("Annotations updated successfully")

            // Invalidate caches to force fresh data fetch
            invalidateAnnotationBatcherCache()
            invalidateScenarioStepsBatcherCache()
            invalidateMetricBatcherCache()
            // Invalidate run-level metric stats (for overview charts and summary tables)
            invalidateRunMetricStats(runId)

            // Refetch all relevant data to update the UI
            await Promise.all(
                [
                    annotationsQuery?.refetch?.(),
                    stepsQuery?.refetch?.(),
                    metricsQuery?.refetch?.(),
                ].filter(Boolean),
            )

            setAnnotationMetrics({})
            setTempSelectedEvaluators([])
            onClose()
        } catch (error: any) {
            console.error("Failed to submit annotations", error)
            const apiErrors =
                error?.response?.data?.detail?.map((err: any) => err.msg)?.filter(Boolean) || []
            if (apiErrors.length) {
                setErrorMessage(apiErrors)
            } else {
                message.error("Failed to submit annotations")
            }
        } finally {
            setIsSubmitting(false)
        }
    }, [
        canSubmitAnnotations,
        combinedAnnotations,
        annotationMetrics,
        evaluatorDtos,
        invocationStepKey,
        testsetId,
        testcaseId,
        selectedEvaluators,
        traceSpanIds,
        annotationsQuery,
        stepsQuery,
        metricsQuery,
        onClose,
        runId,
        scenarioId,
        invalidateRunMetricStats,
    ])

    useEffect(() => {
        onStateChange?.({canSubmit: canSubmitAnnotations, isSubmitting})
    }, [canSubmitAnnotations, isSubmitting, onStateChange])

    useEffect(() => {
        registerSubmit?.(handleAnnotate)
    }, [registerSubmit, handleAnnotate])

    if (stepsLoading) {
        return (
            <div className="flex items-center justify-center">
                <Spin size="small" />
            </div>
        )
    }

    return (
        <div className="annotate-control-wrapper flex flex-col gap-3 min-h-[400px]">
            {!hasInvocationOutput ? (
                <div className="text-neutral-500">
                    To annotate, please generate output for this scenario.
                </div>
            ) : (
                <Annotate
                    annotations={annotationsForAnnotate}
                    updatedMetrics={annotationMetrics}
                    selectedEvaluators={selectedEvaluators}
                    tempSelectedEvaluators={tempSelectedEvaluators}
                    errorMessage={errorMessage}
                    onCaptureError={(errors, addPrev) => {
                        setErrorMessage((prev) => (addPrev ? [...prev, ...errors] : errors))
                    }}
                    setUpdatedMetrics={setAnnotationMetrics}
                    disabled={!hasInvocationOutput}
                />
            )}
        </div>
    )
}

interface VirtualizedScenarioTableAnnotateDrawerProps extends DrawerProps {
    runId?: string
}
const VirtualizedScenarioTableAnnotateDrawer = ({
    runId: propRunId,
    ...props
}: VirtualizedScenarioTableAnnotateDrawerProps) => {
    const store = getDefaultStore()

    // Annotate drawer state (global, per-run)
    const annotateDrawer = useAtomValue(virtualScenarioTableAnnotateDrawerAtom)
    const setAnnotateDrawer = store.set

    const scenarioId = annotateDrawer.scenarioId
    // Use runId from atom state if available, fallback to prop
    const runId = annotateDrawer.runId || propRunId
    const title = annotateDrawer.title || "Annotate scenario"

    const [annotateState, setAnnotateState] = useState<AnnotateActionState>({
        canSubmit: false,
        isSubmitting: false,
    })
    const submitHandlerRef = useRef<(() => Promise<void>) | null>(null)

    useEffect(() => {
        if (!annotateDrawer.open) {
            setAnnotateState({canSubmit: false, isSubmitting: false})
            submitHandlerRef.current = null
        }
    }, [annotateDrawer.open])

    const closeDrawer = useCallback(() => {
        setAnnotateDrawer(
            virtualScenarioTableAnnotateDrawerAtom,
            // @ts-ignore
            (prev) => {
                return {
                    ...prev,
                    open: false,
                }
            },
        )
    }, [])

    const renderTitle = useMemo(
        () => (
            <div className="flex items-center justify-between w-full pr-2">
                <span className="text-base font-medium text-[#0B1F3F]">{title}</span>
                <Button
                    type="primary"
                    disabled={!annotateState.canSubmit}
                    loading={annotateState.isSubmitting}
                    onClick={() => submitHandlerRef.current?.()}
                >
                    Annotate
                </Button>
            </div>
        ),
        [annotateState.canSubmit, annotateState.isSubmitting, title],
    )

    const renderContent = useMemo(() => {
        if (!scenarioId || !runId) {
            return (
                <div className="flex items-center justify-center h-full text-neutral-500">
                    No scenario selected.
                </div>
            )
        }
        return (
            <div className="w-full h-full [&_.annotate-control-wrapper]:p-0">
                <PreviewAnnotateContent
                    scenarioId={scenarioId}
                    runId={runId}
                    onClose={closeDrawer}
                    onStateChange={setAnnotateState}
                    registerSubmit={(handler) => {
                        submitHandlerRef.current = handler
                    }}
                />
            </div>
        )
    }, [closeDrawer, runId, scenarioId])

    return (
        <EnhancedDrawer
            title={renderTitle}
            width={400}
            classNames={{body: "!p-0"}}
            onClose={closeDrawer}
            open={annotateDrawer.open}
            {...props}
        >
            {renderContent}
        </EnhancedDrawer>
    )
}

export default memo(VirtualizedScenarioTableAnnotateDrawer)
