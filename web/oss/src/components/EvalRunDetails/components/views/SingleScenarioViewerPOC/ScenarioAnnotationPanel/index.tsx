import {memo, useCallback, useEffect, useMemo, useRef, useState} from "react"

import {message} from "@agenta/ui/app-message"
import {useQueryClient} from "@tanstack/react-query"
import {Button, Card, Typography} from "antd"
import {useSetAtom} from "jotai"

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
import {getProjectValues} from "@/oss/state/project"

import {invalidateAnnotationBatcherCache} from "../../../../atoms/annotations"
import {
    invalidateMetricBatcherCache,
    markScenarioAsRecentlySaved,
    triggerMetricsRefresh,
} from "../../../../atoms/metrics"
import {invalidatePreviewRunMetricStatsAtom} from "../../../../atoms/runMetrics"
import {invalidateScenarioStepsBatcherCache} from "../../../../atoms/scenarioSteps"
import {buildScenarioMetricDataFromAnnotation} from "../../../../utils/buildAnnotationMetricData"
import type {ScenarioAnnotationPanelProps} from "../types"

import AnnotationForm from "./AnnotationForm"
import RunOverlay from "./RunOverlay"
import {useAnnotationState} from "./useAnnotationState"

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
    // Track the expected annotation count after save - used to detect when refetch completes
    const expectedAnnotationCountRef = useRef<number | null>(null)
    const queryClient = useQueryClient()
    const invalidateRunMetricStats = useSetAtom(invalidatePreviewRunMetricStatsAtom)
    const invalidateRunsTable = useSetAtom(invalidateEvaluationRunsTableAtom)

    // Use the new hook for all annotation state management
    const {
        metrics,
        errors,
        hasPendingChanges,
        allRequiredFieldsFilled,
        unannotatedSlugs,
        traceSpanIds,
        invocationStepKey,
        annotationStepKeyBySlug,
        updateMetric,
        setErrors,
        dismissError,
    } = useAnnotationState({
        scenarioId,
        evaluators,
        annotations,
        invocationSteps,
        allSteps,
    })

    // Reset justSaved when annotations are refetched after save
    // We wait for the expected number of annotations to arrive before allowing new edits
    useEffect(() => {
        if (!justSaved) return

        const expectedCount = expectedAnnotationCountRef.current
        if (expectedCount !== null && annotations.length >= expectedCount) {
            // Annotations have been refetched - reset justSaved
            expectedAnnotationCountRef.current = null
            setJustSaved(false)
        }
    }, [justSaved, annotations.length])

    // Check if we can submit
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

    // Handle metric change from form
    const handleMetricChange = useCallback(
        (slug: string, fieldKey: string, value: unknown) => {
            updateMetric({slug, fieldKey, value})
        },
        [updateMetric],
    )

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
            for (const ann of annotations) {
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

            const stepResultUpdates: Promise<void>[] = []
            responses.forEach((response, index) => {
                const request = allRequests[index]
                if (!request.slug || !invocationStepKey) return

                let annotationTraceId: string | undefined
                let annotationSpanId: string | undefined

                if (request.isNew) {
                    // Axios response has data in response.data
                    // The annotation API returns the annotation directly in data
                    const axiosResp = response as {data?: Record<string, unknown>}
                    const annData = axiosResp?.data ?? {}

                    // Try multiple possible locations for trace_id/span_id
                    annotationTraceId =
                        (annData.trace_id as string) ??
                        (annData.traceId as string) ??
                        ((annData.annotation as Record<string, unknown>)?.trace_id as string)
                    annotationSpanId =
                        (annData.span_id as string) ??
                        (annData.spanId as string) ??
                        ((annData.annotation as Record<string, unknown>)?.span_id as string)
                } else {
                    annotationTraceId = request.traceId
                    annotationSpanId = request.spanId
                }

                if (annotationTraceId && annotationSpanId) {
                    const existingStepKey = annotationStepKeyBySlug[request.slug]
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
                } else {
                    console.warn("[ScenarioAnnotationPanel] Missing trace/span IDs:", {
                        slug: request.slug,
                        annotationTraceId,
                        annotationSpanId,
                    })
                }
            })

            if (stepResultUpdates.length > 0) {
                await Promise.all(stepResultUpdates)
            }

            // After updating step results, query all results for this scenario
            // and determine the correct scenario status
            let scenarioStatus: "success" | "error" = "success"
            try {
                const {queryStepResults} = await import("@/oss/services/evaluations/results/api")
                const allResults = await queryStepResults({runId, scenarioId})

                // Check if any result has an error status
                const hasError = allResults.some((r) => {
                    const status = (r.status ?? "").toLowerCase()
                    return status === "error" || status === "failure" || status === "failed"
                })

                // Check if all results are successful
                const allSuccess = allResults.every((r) => {
                    const status = (r.status ?? "").toLowerCase()
                    return status === "success" || status === "completed" || status === "done"
                })

                if (hasError) {
                    scenarioStatus = "error"
                } else if (allSuccess) {
                    scenarioStatus = "success"
                }
            } catch (err) {
                console.error("[ScenarioAnnotationPanel] Error querying results:", err)
                // Default to success if we can't query results
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

            // Update scenario status based on all step results
            await updateScenarioStatus(scenarioId, scenarioStatus)

            // Check if all scenarios in the run are complete and update run status
            await checkAndUpdateRunStatus(runId)

            // Set expected annotation count - we expect at least as many annotations as evaluators
            // This is used to detect when the refetch completes
            const currentAnnotationCount = annotations.length
            const newAnnotationsCount = allRequests.filter((r) => r.isNew).length
            expectedAnnotationCountRef.current = currentAnnotationCount + newAnnotationsCount

            // Mark as just saved - this disables the button until annotations are refetched
            setJustSaved(true)

            // Mark scenario as recently saved to prevent metric refresh from triggering
            markScenarioAsRecentlySaved(scenarioId)

            // Trigger metrics refresh for scenario-level and run-level metrics
            const {projectId} = getProjectValues()
            if (projectId) {
                await triggerMetricsRefresh({projectId, runId, scenarioId})
            }

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
                    // Invalidate the preview table store to update scenarioRow status
                    if (key[0] === "evaluation-preview-table") return true
                    // Refetch scenario steps to get new annotation steps with their trace IDs
                    if (key[0] === "preview" && key[1] === "scenario-steps") return true
                    // Refetch annotations (though this may use old traceIds until steps are updated)
                    if (key[0] === "preview" && key[1] === "scenario-annotations") return true
                    return false
                },
            })

            // NOTE: We do NOT reset justSaved here. It will be reset when:
            // 1. The new annotations arrive and update the baseline
            // 2. The user makes a new edit (which means they want to change something)
            // This keeps the button disabled until the save is fully reflected in the UI.
        } finally {
            setIsSubmitting(false)
        }
    }, [
        canSubmit,
        annotations,
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

                {hasInvocationOutput && evaluators?.length > 0 ? (
                    <div className="flex flex-col gap-3">
                        <AnnotationForm
                            evaluators={evaluators}
                            metrics={metrics}
                            errors={errors}
                            disabled={!hasInvocationOutput}
                            onMetricChange={handleMetricChange}
                            onDismissError={dismissError}
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
