import {memo, useCallback, useEffect, useMemo, useState} from "react"

import {useQueryClient} from "@tanstack/react-query"
import {Button, Card, Typography} from "antd"
import {useAtomValue, useSetAtom} from "jotai"

import {message} from "@/oss/components/AppMessageContext"
import {invalidateEvaluationRunsTableAtom} from "@/oss/components/EvaluationRunsTablePOC/atoms/tableStore"
import {clearPreviewRunsCache} from "@/oss/lib/hooks/usePreviewEvaluations/assets/previewRunsRequest"
import {uuidToSpanId} from "@/oss/lib/traces/helpers"
import {createAnnotation, updateAnnotation} from "@/oss/services/annotations/api"
import {upsertStepResultWithAnnotation} from "@/oss/services/evaluations/results/api"
import {
    checkAndUpdateRunStatus,
    updateScenarioStatus,
} from "@/oss/services/evaluations/scenarios/api"
import {upsertScenarioMetricData} from "@/oss/services/runMetrics/api"

import {invalidateAnnotationBatcherCache} from "../../../../atoms/annotations"
import {invalidateMetricBatcherCache} from "../../../../atoms/metrics"
import {invalidatePreviewRunMetricStatsAtom} from "../../../../atoms/runMetrics"
import {invalidateScenarioStepsBatcherCache} from "../../../../atoms/scenarioSteps"
import {buildScenarioMetricDataFromAnnotation} from "../../../../utils/buildAnnotationMetricData"
import type {ScenarioAnnotationPanelProps} from "../types"

import AnnotationForm from "./AnnotationForm"
import {
    allRequiredFieldsFilledAtom,
    annotationStepKeyBySlugAtom,
    effectiveMetricsAtom,
    evaluatorsAtom,
    hasPendingChangesAtom,
    invocationStepKeyAtom,
    resetMetricsAtom,
    setErrorsAtom,
    setScenarioDataAtom,
    traceSpanIdsAtom,
    unannotatedSlugsAtom,
} from "./atoms"
import RunOverlay from "./RunOverlay"

const ScenarioAnnotationPanel = ({
    runId,
    scenarioId,
    evaluators,
    annotations,
    invocationSteps,
    allSteps,
    hasInvocationOutput,
    allInvocationsSuccessful,
    pendingInvocationStepKey,
    isRunningInvocation,
    onRunInvocation,
}: ScenarioAnnotationPanelProps) => {
    const [isSubmitting, setIsSubmitting] = useState(false)
    const [justSaved, setJustSaved] = useState(false)
    const queryClient = useQueryClient()
    const invalidateRunMetricStats = useSetAtom(invalidatePreviewRunMetricStatsAtom)
    const invalidateRunsTable = useSetAtom(invalidateEvaluationRunsTableAtom)

    // Single action to set all scenario data atomically
    const setScenarioData = useSetAtom(setScenarioDataAtom)
    const resetMetrics = useSetAtom(resetMetricsAtom)

    // Read derived state from atoms
    const metrics = useAtomValue(effectiveMetricsAtom)
    const hasPendingChanges = useAtomValue(hasPendingChangesAtom)
    const allRequiredFieldsFilled = useAtomValue(allRequiredFieldsFilledAtom)
    const unannotatedSlugs = useAtomValue(unannotatedSlugsAtom)
    const traceSpanIds = useAtomValue(traceSpanIdsAtom)
    const invocationStepKey = useAtomValue(invocationStepKeyAtom)
    const annotationStepKeyBySlug = useAtomValue(annotationStepKeyBySlugAtom)
    const setErrors = useSetAtom(setErrorsAtom)
    const currentEvaluators = useAtomValue(evaluatorsAtom)

    // Reset justSaved when annotations are updated (refetch completed)
    // Also reset metricEdits since baseline now has the saved values
    useEffect(() => {
        if (justSaved && annotations.length > 0) {
            setJustSaved(false)
            resetMetrics()
        }
    }, [annotations, justSaved, resetMetrics])

    // Sync scenario data to atoms - single atomic update
    useEffect(() => {
        setScenarioData({
            scenarioId,
            runId,
            evaluators,
            annotations,
            invocationSteps,
            allSteps,
        })
    }, [scenarioId, runId, evaluators, annotations, invocationSteps, allSteps, setScenarioData])

    // Get combined annotations for updates (existing annotations)
    const combinedAnnotations = annotations

    // Check if we can submit:
    // - Not just saved (waiting for refetch)
    // - Has trace ID for linking
    // - Has invocation output
    // - Has pending changes (user made edits)
    // - All required fields are filled
    const canSubmit = useMemo(() => {
        if (justSaved) return false
        if (!traceSpanIds.traceId || !hasInvocationOutput) return false
        if (!hasPendingChanges) return false
        if (!allRequiredFieldsFilled) return false
        return true
    }, [
        traceSpanIds.traceId,
        hasInvocationOutput,
        hasPendingChanges,
        justSaved,
        allRequiredFieldsFilled,
    ])

    // Get testcase/testset IDs from primary invocation
    const primaryInvocation = invocationSteps[0]
    const testcaseId =
        primaryInvocation?.testcaseId ??
        primaryInvocation?.testcase_id ??
        primaryInvocation?.testcase?.id
    const testsetId =
        primaryInvocation?.testsetId ??
        primaryInvocation?.testset_id ??
        primaryInvocation?.testset?.id

    // Handle annotation save
    const handleSave = useCallback(async () => {
        if (!canSubmit) return

        setIsSubmitting(true)
        setErrors([])

        try {
            const updateRequests: {
                promise: Promise<unknown>
                slug: string
                traceId: string
                spanId: string
                isNew: false
            }[] = []
            const createRequests: {
                promise: Promise<unknown>
                slug: string
                isNew: true
            }[] = []

            // Process existing annotations (updates)
            for (const ann of combinedAnnotations) {
                const slug = ann.references?.evaluator?.slug
                if (!slug) continue

                const evaluator = evaluators.find((e) => e.slug === slug)
                if (!evaluator) continue

                const metricFields = metrics[slug]
                if (!metricFields) continue

                // Build outputs from metrics
                const outputs: Record<string, unknown> = {}
                for (const [key, field] of Object.entries(metricFields)) {
                    const value = (field as {value: unknown}).value
                    if (value !== undefined && value !== null && value !== "") {
                        outputs[key] = value
                    }
                }

                if (Object.keys(outputs).length === 0) continue

                const entryTraceId = ann.trace_id ?? traceSpanIds.traceId
                const spanId =
                    ann.span_id ?? traceSpanIds.spanId ?? uuidToSpanId(entryTraceId) ?? ""

                if (!entryTraceId || !spanId) continue

                updateRequests.push({
                    promise: updateAnnotation({
                        payload: {
                            annotation: {
                                data: {...ann.data, outputs},
                                meta: (ann.meta ?? {}) as Record<string, unknown>,
                            },
                        },
                        traceId: entryTraceId,
                        spanId,
                    } as unknown as Parameters<typeof updateAnnotation>[0]),
                    slug,
                    traceId: entryTraceId,
                    spanId,
                    isNew: false,
                })
            }

            // Process new annotations (creates)
            for (const slug of unannotatedSlugs) {
                const evaluator = evaluators.find((e) => e.slug === slug)
                if (!evaluator) continue

                const metricFields = metrics[slug]
                if (!metricFields) continue

                // Build outputs from metrics
                const outputs: Record<string, unknown> = {}
                let hasValue = false
                for (const [key, field] of Object.entries(metricFields)) {
                    const value = (field as {value: unknown}).value
                    if (value !== undefined && value !== null && value !== "") {
                        outputs[key] = value
                        hasValue = true
                    }
                }

                if (!hasValue) continue

                const references: Record<string, unknown> = {
                    evaluator: {id: evaluator.id, slug: evaluator.slug},
                }
                if (testsetId) references.testset = {id: testsetId}
                if (testcaseId) references.testcase = {id: testcaseId}

                const links: Record<string, unknown> = invocationStepKey
                    ? {
                          [invocationStepKey]: {
                              trace_id: traceSpanIds.traceId,
                              span_id: traceSpanIds.spanId,
                          },
                      }
                    : {
                          invocation: {
                              trace_id: traceSpanIds.traceId as unknown,
                              span_id: traceSpanIds.spanId as unknown,
                          },
                      }

                createRequests.push({
                    promise: createAnnotation({
                        annotation: {
                            data: {outputs},
                            references,
                            origin: "human",
                            kind: "adhoc",
                            channel: "web",
                            meta: {
                                name: evaluator.name ?? "",
                                description: evaluator.description ?? "",
                            },
                            links,
                        },
                    } as unknown as Parameters<typeof createAnnotation>[0]),
                    slug,
                    isNew: true,
                })
            }

            if (!updateRequests.length && !createRequests.length) {
                message.info("No annotation changes to submit")
                return
            }

            const allRequests = [...updateRequests, ...createRequests]
            const responses = await Promise.all(allRequests.map((r) => r.promise))

            // Update step results with annotation references
            const stepResultUpdates: Promise<void>[] = []
            responses.forEach((response, index) => {
                const request = allRequests[index]
                if (!request.slug || !invocationStepKey) return

                let annotationTraceId: string | undefined
                let annotationSpanId: string | undefined

                if (request.isNew) {
                    const respData = response as {
                        data?: {
                            annotation?: {
                                trace_id?: string
                                span_id?: string
                                traceId?: string
                                spanId?: string
                            }
                            trace_id?: string
                            span_id?: string
                        }
                    }
                    const annData = respData?.data?.annotation ?? respData?.data
                    annotationTraceId =
                        annData?.trace_id ?? (annData as {traceId?: string})?.traceId
                    annotationSpanId = annData?.span_id ?? (annData as {spanId?: string})?.spanId
                } else {
                    annotationTraceId = request.traceId
                    annotationSpanId = request.spanId
                }

                if (annotationTraceId && annotationSpanId) {
                    const existingStepKey = annotationStepKeyBySlug.get(request.slug)
                    const annotationStepKey =
                        existingStepKey ?? `${invocationStepKey}.${request.slug}`
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
                }
            })

            if (stepResultUpdates.length > 0) {
                await Promise.all(stepResultUpdates)
            }

            // Build and save scenario metrics
            let allMetricData: Record<string, Record<string, unknown>> = {}
            for (const [slug, metricFields] of Object.entries(metrics)) {
                const outputs: Record<string, unknown> = {}
                for (const [key, field] of Object.entries(metricFields)) {
                    const value = (field as {value: unknown}).value
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

            if (Object.keys(allMetricData).length > 0) {
                await upsertScenarioMetricData({
                    runId,
                    scenarioId,
                    data: allMetricData,
                })
            }

            message.success("Annotations saved successfully")

            // Update scenario and run status
            await updateScenarioStatus(scenarioId, "success")
            await checkAndUpdateRunStatus(runId)

            // Mark as just saved - this disables the button until annotations are refetched
            setJustSaved(true)

            // Invalidate caches to trigger a refetch of annotations
            invalidateAnnotationBatcherCache()
            invalidateScenarioStepsBatcherCache()
            invalidateMetricBatcherCache()
            invalidateRunMetricStats(runId)

            // Clear the preview runs cache and trigger a background refetch
            clearPreviewRunsCache()
            invalidateRunsTable()
            await queryClient.refetchQueries({
                predicate: (query) => {
                    const key = query.queryKey
                    if (!Array.isArray(key)) return false
                    if (key[0] === "evaluation-runs-table") return true
                    if (key[0] === "preview" && key[1] === "run-metric-stats") return true
                    if (key[0] === "preview" && key[1] === "evaluation-run") return true
                    if (key[0] === "eval-table" && key[1] === "scenarios") return true
                    return false
                },
            })

            // Note: We intentionally do NOT reset metrics here.
            // The metricEdits will be preserved until the cache invalidation
            // triggers a refetch of annotations, which will update the baseline.
            // This prevents the UI from showing empty values between save and refetch.
        } finally {
            setIsSubmitting(false)
        }
    }, [
        canSubmit,
        combinedAnnotations,
        unannotatedSlugs,
        evaluators,
        metrics,
        traceSpanIds,
        invocationStepKey,
        testsetId,
        testcaseId,
        annotationStepKeyBySlug,
        runId,
        scenarioId,
        invalidateRunMetricStats,
        invalidateRunsTable,
        setErrors,
        queryClient,
    ])

    // Show overlay when invocation is not successful
    const showRunOverlay = !allInvocationsSuccessful && pendingInvocationStepKey

    return (
        <div className="flex w-5/12 max-w-[400px] sticky top-0 self-start">
            <Card
                title="Annotations"
                className="w-full relative"
                classNames={{body: "!p-2"}}
                id="focus-section-annotations"
            >
                {showRunOverlay && (
                    <RunOverlay isRunning={isRunningInvocation} onRun={onRunInvocation} />
                )}

                {hasInvocationOutput && currentEvaluators?.length > 0 ? (
                    <div className="flex flex-col gap-3">
                        {/* Key forces remount when scenario changes to reset internal state in child components */}
                        <AnnotationForm
                            key={scenarioId}
                            scenarioId={scenarioId}
                            disabled={!hasInvocationOutput}
                        />
                        <Button
                            type="primary"
                            className="w-full"
                            disabled={!canSubmit || isSubmitting}
                            loading={isSubmitting}
                            onClick={handleSave}
                        >
                            Annotate
                        </Button>
                    </div>
                ) : (
                    <Typography.Text type="secondary">
                        To annotate, please generate output.
                    </Typography.Text>
                )}
            </Card>
        </div>
    )
}

export default memo(ScenarioAnnotationPanel)
