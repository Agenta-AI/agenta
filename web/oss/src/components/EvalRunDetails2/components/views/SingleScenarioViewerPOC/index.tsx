import {memo, useCallback, useEffect, useMemo, useState} from "react"

import {Card, Tag, Typography} from "antd"
import {useAtom, useAtomValue, useSetAtom} from "jotai"
import dynamic from "next/dynamic"
import {useRouter} from "next/router"

import {message} from "@/oss/components/AppMessageContext"
import {useInfiniteTablePagination} from "@/oss/components/InfiniteVirtualTable"
import {uuidToSpanId} from "@/oss/lib/traces/helpers"

import {scenarioAnnotationsQueryAtomFamily} from "../../../atoms/annotations"
import {evaluationMetricQueryAtomFamily} from "../../../atoms/metrics"
import {runningInvocationsAtom, triggerRunInvocationAtom} from "../../../atoms/runInvocationAction"
import {invalidatePreviewRunMetricStatsAtom} from "../../../atoms/runMetrics"
import {scenarioStepsQueryFamily} from "../../../atoms/scenarioSteps"
import type {EvaluationTableColumn} from "../../../atoms/table"
import {evaluationEvaluatorsByRunQueryAtomFamily} from "../../../atoms/table/evaluators"
import {evaluationRunIndexAtomFamily} from "../../../atoms/table/run"
import {evaluationPreviewTableStore} from "../../../evaluationPreviewTableStore"
import usePreviewTableData from "../../../hooks/usePreviewTableData"
import {pocUrlStateAtom} from "../../../state/urlState"

import ColumnValueView from "./ColumnValueView"
import ScenarioAnnotationPanel from "./ScenarioAnnotationPanel"
import ScenarioLoadingIndicator from "./ScenarioLoadingIndicator"
import ScenarioNavigator from "./ScenarioNavigator"
import StepContentRenderer from "./StepContentRenderer"
import {
    extractOutputs,
    filterStepsByKeySet,
    getScenarioStatusColor,
    getStepKey,
    getTraceIdForStep,
} from "./utils"

const SharedGenerationResultUtils = dynamic(
    () => import("@agenta/oss/src/components/SharedGenerationResultUtils"),
    {ssr: false},
)

interface SingleScenarioViewerPOCProps {
    runId: string
}

const EMPTY_ARRAY: any[] = []
const PAGE_SIZE = 50

const normalizeStatus = (status: string | undefined): string => status?.toLowerCase() ?? ""

const SingleScenarioViewerPOC = ({runId}: SingleScenarioViewerPOCProps) => {
    const router = useRouter()
    const [urlState, setUrlState] = useAtom(pocUrlStateAtom)

    // Run invocation action
    const runningInvocations = useAtomValue(runningInvocationsAtom)
    const triggerRunInvocation = useSetAtom(triggerRunInvocationAtom)

    // Invalidate run-level metric stats after annotation updates
    const invalidateRunMetricStats = useSetAtom(invalidatePreviewRunMetricStatsAtom)

    // Data fetching
    const {rows, paginationInfo, loadNextPage} = useInfiniteTablePagination({
        store: evaluationPreviewTableStore,
        scopeId: runId,
        pageSize: PAGE_SIZE,
    })

    const runIndex = useAtomValue(
        useMemo(() => evaluationRunIndexAtomFamily(runId ?? null), [runId]),
    )

    const scenarioRows = useMemo(
        () => rows.filter((row) => !row.__isSkeleton && row.scenarioId),
        [rows],
    )

    const scenarioIds = useMemo(
        () => scenarioRows.map((row) => row.scenarioId as string),
        [scenarioRows],
    )

    const activeId =
        (router.query.scenarioId as string | undefined) ??
        urlState.scenarioId ??
        scenarioIds[0] ??
        null

    const scenarioStepsQuery = useAtomValue(
        useMemo(
            () => scenarioStepsQueryFamily({scenarioId: activeId ?? "", runId}),
            [activeId, runId],
        ),
    )

    const {columnResult} = usePreviewTableData({runId})

    const scenarioRow = useMemo(
        () => scenarioRows.find((row) => row.scenarioId === activeId),
        [scenarioRows, activeId],
    )

    // URL sync effects
    useEffect(() => {
        if (!router.isReady || !scenarioIds.length) return

        const queryScenarioId = router.query.scenarioId as string | undefined
        const currentScenarioId = queryScenarioId ?? urlState.scenarioId

        if (!currentScenarioId || !scenarioIds.includes(currentScenarioId)) {
            setUrlState((draft) => {
                draft.scenarioId = scenarioIds[0]
            })
            router.replace(
                {pathname: router.pathname, query: {...router.query, scenarioId: scenarioIds[0]}},
                undefined,
                {shallow: true},
            )
        }
    }, [router.isReady, scenarioIds, urlState.scenarioId, setUrlState, router])

    useEffect(() => {
        if (!activeId || scenarioIds.includes(activeId)) return
        if (paginationInfo.hasMore && !paginationInfo.isFetching) {
            loadNextPage()
        }
    }, [activeId, scenarioIds, paginationInfo.hasMore, paginationInfo.isFetching, loadNextPage])

    const handleScenarioChange = useCallback(
        (nextScenarioId: string) => {
            setUrlState((draft) => {
                draft.scenarioId = nextScenarioId
            })
            router.replace(
                {pathname: router.pathname, query: {...router.query, scenarioId: nextScenarioId}},
                undefined,
                {shallow: true},
            )
        },
        [setUrlState, router],
    )

    // Step classification using runIndex key sets
    const steps = scenarioStepsQuery?.data?.steps ?? []

    const inputKeysSet = useMemo(
        () => (runIndex?.inputKeys instanceof Set ? runIndex.inputKeys : new Set<string>()),
        [runIndex?.inputKeys],
    )
    const invocationKeysSet = useMemo(
        () =>
            runIndex?.invocationKeys instanceof Set ? runIndex.invocationKeys : new Set<string>(),
        [runIndex?.invocationKeys],
    )
    const annotationKeysSet = useMemo(
        () =>
            runIndex?.annotationKeys instanceof Set ? runIndex.annotationKeys : new Set<string>(),
        [runIndex?.annotationKeys],
    )

    const inputSteps = useMemo(
        () =>
            filterStepsByKeySet(steps, inputKeysSet, (step) => {
                const hasTraceId = Boolean(step?.traceId || step?.trace_id)
                return !hasTraceId
            }),
        [steps, inputKeysSet],
    )

    const invocationSteps = useMemo(
        () =>
            filterStepsByKeySet(steps, invocationKeysSet, (step, key) => {
                const hasTraceId = Boolean(step?.traceId || step?.trace_id)
                const looksLikeAnnotation =
                    key.includes(".") && (key.includes("human") || key.includes("evaluator"))
                return hasTraceId && !looksLikeAnnotation
            }),
        [steps, invocationKeysSet],
    )

    const annotationSteps = useMemo(
        () =>
            filterStepsByKeySet(steps, annotationKeysSet, (step, key) => {
                const hasTraceId = Boolean(step?.traceId || step?.trace_id)
                return hasTraceId && key.includes(".")
            }),
        [steps, annotationKeysSet],
    )

    const primaryInvocation = invocationSteps[0]
    const primaryInvocationTrace = useMemo(() => {
        if (!primaryInvocation) return null
        return (
            primaryInvocation?.trace ??
            primaryInvocation?.traceData ??
            primaryInvocation?.trace_data ??
            primaryInvocation?.data?.trace ??
            null
        )
    }, [primaryInvocation])

    // Loading states
    const isLoadingScenarios = rows.length === 0 && paginationInfo.isFetching
    const isLoadingSteps = scenarioStepsQuery?.status === "pending" && !scenarioStepsQuery?.data

    // Column definitions
    const inputColumns: EvaluationTableColumn[] = useMemo(() => {
        if (!columnResult?.groups?.length) return []
        const ids = new Set<string>()
        columnResult.groups
            .filter((group) => group.kind === "input")
            .forEach((group) => group.columnIds.forEach((id) => ids.add(id)))
        return columnResult.columns.filter((col) => ids.has(col.id))
    }, [columnResult])

    const outputColumns: EvaluationTableColumn[] = useMemo(() => {
        if (!columnResult?.groups?.length) return []
        const ids = new Set<string>()
        columnResult.groups
            .filter((group) => group.kind === "invocation")
            .forEach((group) => group.columnIds.forEach((id) => ids.add(id)))
        return columnResult.columns.filter((col) => ids.has(col.id))
    }, [columnResult])

    // Annotations
    const traceIds = useMemo(
        () =>
            annotationSteps
                .map((step: any) => step?.traceId)
                .filter((id): id is string => Boolean(id)),
        [annotationSteps],
    )
    const traceIdsKey = useMemo(() => traceIds.join("|"), [traceIds])

    const annotationsQueryAtom = useMemo(
        () => scenarioAnnotationsQueryAtomFamily({traceIds, runId}),
        [traceIdsKey, runId],
    )
    const annotationsQuery = useAtomValue(annotationsQueryAtom)

    const metricsQuery = useAtomValue(
        useMemo(
            () => evaluationMetricQueryAtomFamily({scenarioId: activeId ?? "", runId}),
            [activeId, runId],
        ),
    )

    const existingAnnotations = useMemo(() => {
        const fromQuery = annotationsQuery?.data?.length ? annotationsQuery.data : null
        const fromSteps = annotationSteps
            .map((step: any) => step?.annotation ?? step?.annotations ?? step?.data?.annotations)
            .filter(Boolean) as any[]

        const result = fromQuery ?? fromSteps

        console.log("[SingleScenarioViewerPOC] existingAnnotations computed:", {
            activeId,
            fromQueryCount: fromQuery?.length ?? 0,
            fromStepsCount: fromSteps.length,
            resultCount: result.length,
            result: result.map((a: any) => ({
                slug: a?.references?.evaluator?.slug,
                outputs: a?.data?.outputs,
            })),
        })

        return result
    }, [annotationsQuery?.data, annotationSteps, activeId])

    // Local annotation state
    const [localAnnotations, setLocalAnnotations] = useState<any[]>([])
    const [_annotationErrors, _setAnnotationErrors] = useState<string[]>([])
    const [annotationMetrics, setAnnotationMetrics] = useState<Record<string, any>>({})
    const [_isSubmitting, _setIsSubmitting] = useState(false)

    // Reset annotation state when scenario changes
    useEffect(() => {
        // Always reset when activeId changes
        setAnnotationMetrics({})
        setLocalAnnotations([])
        _setAnnotationErrors([])
    }, [activeId])

    // Combined annotations (existing + local optimistic updates)
    const combinedAnnotations = useMemo(() => {
        const bySlug = new Map<string, any>()
        ;(existingAnnotations ?? []).forEach((ann: any) => {
            const slug = ann?.references?.evaluator?.slug
            if (slug) bySlug.set(slug, ann)
        })
        ;(localAnnotations ?? []).forEach((ann: any) => {
            const slug = ann?.references?.evaluator?.slug
            if (slug) bySlug.set(slug, ann)
        })
        return Array.from(bySlug.values())
    }, [existingAnnotations, localAnnotations])

    const annotatedSlugs = useMemo(() => {
        const slugs = new Set<string>()
        combinedAnnotations?.forEach((ann: any) => {
            const slug = ann?.references?.evaluator?.slug
            if (slug) slugs.add(slug)
        })
        return slugs
    }, [combinedAnnotations])

    // Evaluators
    const evaluatorQuery = useAtomValue(
        useMemo(() => evaluationEvaluatorsByRunQueryAtomFamily(runId ?? null), [runId]),
    )

    const evaluatorDtos = useMemo(() => {
        const list = (evaluatorQuery?.data || EMPTY_ARRAY) as any[]
        return list.map((e: any) => e?.raw ?? e).filter(Boolean)
    }, [evaluatorQuery])

    const _annotationsForAnnotate = useMemo(() => [...combinedAnnotations], [combinedAnnotations])

    const selectedEvaluators = useMemo(
        () =>
            evaluatorDtos
                .map((e: any) => e.slug)
                .filter((slug: any) => Boolean(slug) && !annotatedSlugs.has(slug)),
        [evaluatorDtos, annotatedSlugs],
    )

    // Baseline for change detection
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

    // Create a stable key for the Annotate component based on actual values
    const _annotateComponentKey = useMemo(() => {
        const metricsHash = JSON.stringify(baselineMetrics)
        return `${activeId}-${metricsHash.slice(0, 50)}`
    }, [activeId, baselineMetrics])

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

    // Build a map from evaluator slug to existing annotation step key
    const annotationStepKeyBySlug = useMemo(() => {
        const map = new Map<string, string>()
        const allSteps = scenarioStepsQuery?.data?.steps ?? []
        allSteps.forEach((step: any) => {
            const stepKey = step?.stepKey ?? step?.step_key ?? step?.key
            if (!stepKey || !stepKey.includes(".")) return
            const parts = stepKey.split(".")
            const slug = parts.length > 1 ? parts[parts.length - 1] : null
            if (slug) {
                map.set(slug, stepKey)
            }
        })
        return map
    }, [scenarioStepsQuery?.data?.steps])

    // Find the step that has a trace_id for linking annotations
    const stepWithTraceId = useMemo(() => {
        const allSteps = scenarioStepsQuery?.data?.steps ?? []
        const invocationWithTrace = invocationSteps.find(
            (step: any) => step?.traceId || step?.trace_id,
        )
        if (invocationWithTrace) return invocationWithTrace
        const nonAnnotationWithTrace = allSteps.find((step: any) => {
            const stepKey = step?.stepKey ?? step?.step_key ?? step?.key ?? ""
            const looksLikeAnnotation = stepKey.includes(".")
            return !looksLikeAnnotation && (step?.traceId || step?.trace_id)
        })
        return nonAnnotationWithTrace ?? primaryInvocation
    }, [invocationSteps, scenarioStepsQuery?.data?.steps, primaryInvocation])

    // Compute trace/span IDs for annotation linking
    const traceSpanIds = useMemo(() => {
        const annotationTrace = combinedAnnotations?.[0]?.trace_id
        const annotationSpan =
            combinedAnnotations?.[0]?.span_id ??
            combinedAnnotations?.[0]?.links?.invocation?.span_id
        const sourceStep = stepWithTraceId ?? primaryInvocation
        const resolvedTraceId =
            sourceStep?.traceId ?? sourceStep?.trace_id ?? annotationTrace ?? traceIds[0] ?? ""
        const resolvedSpanId =
            sourceStep?.spanId ??
            sourceStep?.span_id ??
            (combinedAnnotations?.[0]?.links as any)?.invocation?.span_id ??
            annotationSpan ??
            (resolvedTraceId ? uuidToSpanId(resolvedTraceId) : undefined)
        return {traceId: resolvedTraceId, spanId: resolvedSpanId}
    }, [combinedAnnotations, stepWithTraceId, primaryInvocation, traceIds])

    // Get the invocation step key for annotation linking
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

    // Get testcase/testset IDs
    const testcaseId =
        (primaryInvocation as any)?.testcaseId ??
        (primaryInvocation as any)?.testcase_id ??
        (primaryInvocation as any)?.testcase?.id
    const testsetId =
        (primaryInvocation as any)?.testsetId ??
        (primaryInvocation as any)?.testset_id ??
        (primaryInvocation as any)?.testset?.id

    const hasInvocationOutput =
        invocationSteps.some((step) => Boolean(extractOutputs(step))) || outputColumns.length > 0

    const canSubmitAnnotations =
        !!traceSpanIds.traceId &&
        hasInvocationOutput &&
        (hasPendingAnnotationChanges || hasNewAnnotationMetrics)

    // Check if all invocations are successful
    const allInvocationsSuccessful = useMemo(() => {
        if (invocationSteps.length === 0) return false
        return invocationSteps.every((step) => normalizeStatus(step.status) === "success")
    }, [invocationSteps])

    // Find the first pending (non-successful) invocation step key for the Run button
    const pendingInvocationStepKey = useMemo(() => {
        if (!runIndex?.invocationKeys) return null
        const invocationKeys = Array.from(runIndex.invocationKeys)
        for (const key of invocationKeys) {
            const step = invocationSteps.find((s) => (s.stepKey ?? s.step_key) === key)
            if (!step || normalizeStatus(step.status) !== "success") {
                return key
            }
        }
        return null
    }, [runIndex?.invocationKeys, invocationSteps])

    // Handle run invocation click
    const handleRunInvocation = useCallback(() => {
        if (!activeId || !runId || !pendingInvocationStepKey) return
        triggerRunInvocation({scenarioId: activeId, runId, stepKey: pendingInvocationStepKey})
    }, [activeId, runId, pendingInvocationStepKey, triggerRunInvocation])

    // Check if the current scenario's invocation is running
    const isRunningInvocation = useMemo(() => {
        if (!activeId || !pendingInvocationStepKey) return false
        return runningInvocations.has(`${activeId}:${pendingInvocationStepKey}`)
    }, [activeId, pendingInvocationStepKey, runningInvocations])

    const scenarioStatusColor = useMemo(
        () => getScenarioStatusColor(scenarioRow?.status as string | undefined),
        [scenarioRow?.status],
    )

    // Keyboard shortcut: ⌘+Enter (Mac) or Ctrl+Enter (Windows) to run invocation
    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0
            const modifierKey = isMac ? event.metaKey : event.ctrlKey

            if (modifierKey && event.key === "Enter") {
                event.preventDefault()
                if (pendingInvocationStepKey && !isRunningInvocation) {
                    handleRunInvocation()
                }
            }
        }

        window.addEventListener("keydown", handleKeyDown)
        return () => window.removeEventListener("keydown", handleKeyDown)
    }, [pendingInvocationStepKey, isRunningInvocation, handleRunInvocation])

    // Handle annotation save - mirrors VirtualizedScenarioTableAnnotateDrawer logic
    // NOTE: This is now handled by ScenarioAnnotationPanel, kept for reference
    const _handleAnnotationSave = useCallback(async () => {
        if (!canSubmitAnnotations || !activeId) return

        setIsSubmitting(true)
        setAnnotationErrors([])

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
                setAnnotationErrors(errors)
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
                const entryTraceId = entry.trace_id || traceSpanIds.traceId
                const isValidSpanId = (id: string | undefined) =>
                    id && id !== "missing" && id.length > 0
                const spanId = isValidSpanId(entry.span_id)
                    ? entry.span_id
                    : isValidSpanId(traceSpanIds.spanId)
                      ? traceSpanIds.spanId
                      : uuidToSpanId(entryTraceId)
                if (!entryTraceId || !spanId) return

                const ann = combinedAnnotations.find(
                    (a: any) =>
                        (a.trace_id === entry.trace_id && a.span_id === entry.span_id) ||
                        (a.trace_id === entryTraceId && a.span_id === spanId),
                )
                const slug = ann?.references?.evaluator?.slug || ""

                updateRequests.push({
                    promise: updateAnnotation({
                        payload: {annotation: entry.annotation},
                        traceId: entryTraceId,
                        spanId,
                    }),
                    slug,
                    traceId: entryTraceId,
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

            const allRequests = [...updateRequests, ...createRequests]
            const responses = await Promise.all(allRequests.map((r) => r.promise))

            // Update step results with annotation references
            try {
                const stepResultUpdates: Promise<void>[] = []

                responses.forEach((response, index) => {
                    const request = allRequests[index]
                    if (!request.slug || !invocationStepKey) return

                    let annotationTraceId: string | undefined
                    let annotationSpanId: string | undefined

                    if (request.isNew) {
                        const annData = response?.data?.annotation || response?.data
                        annotationTraceId = annData?.trace_id || annData?.traceId
                        annotationSpanId = annData?.span_id || annData?.spanId
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
                                scenarioId: activeId,
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
            } catch (stepError) {
                console.warn("[SingleScenarioViewerPOC] Failed to update step results", stepError)
            }

            // Build and save scenario metrics from the annotation data
            try {
                let allMetricData: Record<string, Record<string, unknown>> = {}

                for (const ann of combinedAnnotations) {
                    const slug = ann?.references?.evaluator?.slug
                    const updatedMetric = annotationMetrics[slug]
                    if (!slug || !updatedMetric) continue

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

                for (const slug of selectedEvaluators) {
                    const updatedMetric = annotationMetrics[slug]
                    if (!updatedMetric) continue

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

                if (Object.keys(allMetricData).length > 0) {
                    await upsertScenarioMetricData({
                        runId,
                        scenarioId: activeId,
                        data: allMetricData,
                    })
                }
            } catch (metricError) {
                console.warn(
                    "[SingleScenarioViewerPOC] Failed to update scenario metrics",
                    metricError,
                )
            }

            message.success("Annotations saved successfully")

            // Invalidate caches to force fresh data fetch
            invalidateAnnotationBatcherCache()
            invalidateScenarioStepsBatcherCache()
            invalidateMetricBatcherCache()
            invalidateRunMetricStats(runId)

            // Refetch all relevant data to update the UI
            await Promise.all(
                [
                    annotationsQuery?.refetch?.(),
                    scenarioStepsQuery?.refetch?.(),
                    metricsQuery?.refetch?.(),
                ].filter(Boolean),
            )

            setAnnotationMetrics({})
            setLocalAnnotations([])
        } catch (error: any) {
            console.error("[SingleScenarioViewerPOC] Failed to submit annotations", error)
            const apiErrors =
                error?.response?.data?.detail?.map((err: any) => err.msg)?.filter(Boolean) || []
            if (apiErrors.length) {
                setAnnotationErrors(apiErrors)
            } else {
                message.error("Failed to submit annotations")
            }
        } finally {
            setIsSubmitting(false)
        }
    }, [
        canSubmitAnnotations,
        activeId,
        combinedAnnotations,
        annotationMetrics,
        evaluatorDtos,
        invocationStepKey,
        testsetId,
        testcaseId,
        selectedEvaluators,
        traceSpanIds,
        annotationStepKeyBySlug,
        runId,
        annotationsQuery,
        scenarioStepsQuery,
        metricsQuery,
        invalidateRunMetricStats,
    ])

    // Early returns for loading/empty states
    if (isLoadingScenarios) {
        return <ScenarioLoadingIndicator message="Loading scenarios..." />
    }

    if (!scenarioIds.length) {
        return <Typography.Text type="secondary">No scenarios to display.</Typography.Text>
    }

    if (!activeId) {
        return <Typography.Text type="secondary">Loading scenario...</Typography.Text>
    }

    if (isLoadingSteps) {
        return <ScenarioLoadingIndicator message="Loading scenario data..." />
    }

    return (
        <section className="relative flex min-h-0 w-full h-full overflow-hidden">
            <div className="flex w-full min-h-0 flex-col gap-3 px-3">
                {/* Header */}
                <div className="w-full p-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <ScenarioNavigator
                            runId={runId}
                            scenarioId={activeId}
                            onChange={handleScenarioChange}
                            showScenarioIdTag={false}
                        />
                        <div className="flex items-center gap-2 text-xs">
                            {scenarioRow?.status ? (
                                <Tag color={scenarioStatusColor} className="m-0">
                                    {String(scenarioRow.status)}
                                </Tag>
                            ) : null}
                            <Typography.Text
                                type="secondary"
                                copyable={{text: activeId}}
                                className="text-xs"
                            >
                                {activeId}
                            </Typography.Text>
                        </div>
                    </div>
                </div>

                {/* Content */}
                <div className="flex min-h-0 flex-col gap-3 w-full">
                    <div className="flex gap-3 w-full items-start">
                        <div className="flex flex-col gap-3 shrink min-w-0 grow w-7/12">
                            {/* Inputs Card */}
                            <Card title="Inputs" id="focus-section-inputs">
                                {!columnResult ? (
                                    <Typography.Text type="secondary">
                                        Loading inputs…
                                    </Typography.Text>
                                ) : inputColumns.length ? (
                                    <div className="flex flex-col gap-4">
                                        {inputColumns.map((column) => (
                                            <div key={column.id} className="flex flex-col gap-2">
                                                <Typography.Text strong>
                                                    {column.displayLabel ?? column.label}
                                                </Typography.Text>
                                                <ColumnValueView
                                                    column={column}
                                                    scenarioId={activeId}
                                                    runId={runId}
                                                />
                                            </div>
                                        ))}
                                    </div>
                                ) : inputSteps.length ? (
                                    <div className="flex flex-col gap-4">
                                        {inputSteps.map((step) => (
                                            <div
                                                key={step.id ?? getStepKey(step)}
                                                className="flex flex-col gap-2"
                                            >
                                                <Typography.Text strong>
                                                    {getStepKey(step) || "Input"}
                                                </Typography.Text>
                                                <StepContentRenderer step={step} />
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <Typography.Text type="secondary">
                                        No input data.
                                    </Typography.Text>
                                )}
                            </Card>

                            {/* Output Card */}
                            <Card title="Output" id="focus-section-outputs">
                                {!columnResult ? (
                                    <Typography.Text type="secondary">
                                        Loading invocation…
                                    </Typography.Text>
                                ) : outputColumns.length ? (
                                    <div className="flex flex-col gap-4">
                                        {outputColumns.map((column) => (
                                            <div key={column.id} className="flex flex-col gap-2">
                                                <ColumnValueView
                                                    column={column}
                                                    scenarioId={activeId}
                                                    runId={runId}
                                                />
                                            </div>
                                        ))}
                                        {invocationSteps.length ? (
                                            <SharedGenerationResultUtils
                                                className="!mt-1"
                                                traceId={getTraceIdForStep(
                                                    invocationSteps[0],
                                                    primaryInvocationTrace,
                                                )}
                                            />
                                        ) : null}
                                    </div>
                                ) : invocationSteps.length ? (
                                    <div className="flex flex-col gap-4">
                                        {invocationSteps.map((step) => (
                                            <div
                                                key={step.id ?? getStepKey(step)}
                                                className="flex flex-col gap-2"
                                            >
                                                <StepContentRenderer
                                                    step={step}
                                                    includeTraceUtils
                                                    fallbackTrace={primaryInvocationTrace}
                                                />
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <Typography.Text type="secondary">
                                        No invocation data.
                                    </Typography.Text>
                                )}
                            </Card>
                        </div>

                        {/* Annotations Card - Using new reliable ScenarioAnnotationPanel */}
                        <ScenarioAnnotationPanel
                            runId={runId}
                            scenarioId={activeId}
                            evaluators={evaluatorDtos}
                            annotations={existingAnnotations}
                            invocationSteps={invocationSteps}
                            allSteps={steps}
                            hasInvocationOutput={hasInvocationOutput}
                            allInvocationsSuccessful={allInvocationsSuccessful}
                            pendingInvocationStepKey={pendingInvocationStepKey}
                            isRunningInvocation={isRunningInvocation}
                            onRunInvocation={handleRunInvocation}
                        />
                    </div>
                </div>
            </div>
        </section>
    )
}

export default memo(SingleScenarioViewerPOC)

// Re-export classifyStep for backward compatibility
export {classifyStep} from "./utils"
