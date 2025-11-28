import {memo, useCallback, useEffect, useMemo, useState} from "react"

import {Button, Card, Tag, Typography} from "antd"
import deepEqual from "fast-deep-equal"
import {useAtom, useAtomValue} from "jotai"
import dynamic from "next/dynamic"
import {useRouter} from "next/router"

import {useInfiniteTablePagination} from "@/oss/components/InfiniteVirtualTable"
import {getInitialMetricsFromAnnotations} from "@/oss/components/pages/observability/drawer/AnnotateDrawer/assets/transforms"

import {scenarioAnnotationsQueryAtomFamily} from "../../atoms/annotations"
import {scenarioStepsQueryFamily} from "../../atoms/scenarioSteps"
import type {EvaluationTableColumn} from "../../atoms/table"
import {evaluationEvaluatorsByRunQueryAtomFamily} from "../../atoms/table/evaluators"
import {evaluationRunIndexAtomFamily} from "../../atoms/table/run"
import {evaluationPreviewTableStore} from "../../evaluationPreviewTableStore"
import usePreviewTableData from "../../hooks/usePreviewTableData"
import useScenarioCellValue from "../../hooks/useScenarioCellValue"
import {pocUrlStateAtom} from "../../state/urlState"
import {renderScenarioChatMessages} from "../../utils/chatMessages"

import ScenarioLoadingIndicator from "./SingleScenarioViewerPOC/ScenarioLoadingIndicator"
import ScenarioNavigator from "./SingleScenarioViewerPOC/ScenarioNavigator"

const Annotate = dynamic(
    () =>
        import(
            "@agenta/oss/src/components/pages/observability/drawer/AnnotateDrawer/assets/Annotate"
        ),
    {ssr: false},
)
const SharedGenerationResultUtils = dynamic(
    () => import("@agenta/oss/src/components/SharedGenerationResultUtils"),
    {ssr: false},
)

interface SingleScenarioViewerPOCProps {
    runId: string
}

const EMPTY_ARRAY = []

const stepType = (step: any) =>
    ((step?.type ?? step?.kind ?? step?.stepType ?? step?.step_type ?? "") as string).toLowerCase()

export const classifyStep = (step: any): "input" | "invocation" | "annotation" | null => {
    const t = stepType(step)
    if (t === "input" || t === "invocation" || t === "annotation") return t

    if (
        step?.inputs ||
        step?.input ||
        step?.groundTruth ||
        step?.testcase ||
        step?.data?.inputs ||
        step?.data?.input ||
        step?.payload?.inputs ||
        step?.payload?.input
    ) {
        return "input"
    }

    if (
        step?.annotation ||
        step?.annotations ||
        step?.data?.annotations ||
        step?.payload?.annotations
    ) {
        return "annotation"
    }

    if (
        step?.traceId ||
        step?.invocationParameters ||
        step?.outputs ||
        step?.output ||
        step?.response ||
        step?.result ||
        step?.data?.outputs ||
        step?.data?.output ||
        step?.payload?.outputs ||
        step?.payload?.output
    ) {
        return "invocation"
    }

    const key = (step?.stepKey ?? step?.step_key ?? step?.key ?? "") as string
    if (key.includes("human") || key.includes("annotation")) return "annotation"
    if (key) return "invocation"

    return null
}

const SingleScenarioViewerPOC = ({runId}: SingleScenarioViewerPOCProps) => {
    const effectiveRunId = runId
    const {rows, paginationInfo, loadNextPage} = useInfiniteTablePagination({
        store: evaluationPreviewTableStore,
        scopeId: effectiveRunId,
        pageSize: 50,
    })
    const runIndex = useAtomValue(
        useMemo(() => evaluationRunIndexAtomFamily(effectiveRunId ?? null), [effectiveRunId]),
    )

    const scenarioRows = useMemo(
        () => rows.filter((row) => !row.__isSkeleton && row.scenarioId),
        [rows],
    )
    const scenarioIds = useMemo(
        () => scenarioRows.map((row) => row.scenarioId as string),
        [scenarioRows],
    )
    const router = useRouter()
    const [urlState, setUrlState] = useAtom(pocUrlStateAtom)

    const activeId =
        (router.query.scenarioId as string | undefined) ??
        urlState.scenarioId ??
        scenarioIds[0] ??
        null

    const scenarioStepsQuery = useAtomValue(
        useMemo(
            () =>
                scenarioStepsQueryFamily({
                    scenarioId: activeId ?? "",
                    runId: effectiveRunId,
                }),
            [activeId, effectiveRunId],
        ),
    )
    const {columnResult} = usePreviewTableData({runId: effectiveRunId})

    const scenarioRow = useMemo(
        () => scenarioRows.find((row) => row.scenarioId === activeId),
        [scenarioRows, activeId],
    )

    useEffect(() => {
        if (!router.isReady) return
        if (!scenarioIds.length) return

        const queryScenarioId = router.query.scenarioId as string | undefined
        const currentScenarioId = queryScenarioId ?? urlState.scenarioId
        if (!currentScenarioId || !scenarioIds.includes(currentScenarioId)) {
            setUrlState((draft) => {
                draft.scenarioId = scenarioIds[0]
            })
            router.replace(
                {
                    pathname: router.pathname,
                    query: {...router.query, scenarioId: scenarioIds[0]},
                },
                undefined,
                {shallow: true},
            )
        }
    }, [
        router.isReady,
        scenarioIds,
        urlState.scenarioId,
        setUrlState,
        router.pathname,
        router.query.scenarioId,
    ])

    useEffect(() => {
        if (!activeId) return
        if (scenarioIds.includes(activeId)) return
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
                {
                    pathname: router.pathname,
                    query: {...router.query, scenarioId: nextScenarioId},
                },
                undefined,
                {shallow: true},
            )
        },
        [setUrlState, router],
    )

    const steps = scenarioStepsQuery?.data?.steps ?? []

    const inputSteps = useMemo(() => {
        const base =
            scenarioStepsQuery?.data?.inputSteps && scenarioStepsQuery.data.inputSteps.length
                ? [...scenarioStepsQuery.data.inputSteps]
                : scenarioStepsQuery?.data?.inputStep
                  ? [scenarioStepsQuery.data.inputStep as any]
                  : steps

        const inputKeysFromIndex = new Set<string>()
        if (runIndex?.steps) {
            Object.values(runIndex.steps).forEach((meta: any) => {
                if (meta?.kind === "input" && meta?.key) {
                    inputKeysFromIndex.add(String(meta.key))
                }
            })
        }

        return base.filter((step) => {
            const key = String(step?.stepKey || step?.step_key || step?.key || "")
            const type = (
                step?.type ||
                step?.kind ||
                step?.stepType ||
                step?.step_type ||
                ""
            ).toLowerCase()

            const isInputByIndex = inputKeysFromIndex.size ? inputKeysFromIndex.has(key) : false
            const isInput = isInputByIndex || type === "input" || classifyStep(step) === "input"
            return isInput
        })
    }, [scenarioStepsQuery?.data?.inputSteps, scenarioStepsQuery?.data?.inputStep, steps, runIndex])

    const invocationSteps = useMemo(() => {
        const base =
            scenarioStepsQuery?.data?.invocationSteps &&
            scenarioStepsQuery.data.invocationSteps.length
                ? scenarioStepsQuery.data.invocationSteps
                : steps

        const invocationKeysFromIndex = new Set<string>()
        if (runIndex?.steps) {
            Object.values(runIndex.steps).forEach((meta: any) => {
                if (meta?.kind === "invocation" && meta?.key) {
                    invocationKeysFromIndex.add(String(meta.key))
                }
            })
        }

        // Defensive filter to keep only actual invocation steps with outputs/trace
        return base.filter((step) => {
            const keyRaw = step?.stepKey || step?.step_key || step?.key || ""
            const key = String(keyRaw)
            const type = (
                step?.type ||
                step?.kind ||
                step?.stepType ||
                step?.step_type ||
                ""
            ).toLowerCase()

            const isInvocationByIndex = invocationKeysFromIndex.size
                ? invocationKeysFromIndex.has(key)
                : false

            // Prefer explicit invocation type; fallback to classifier
            const isInvocation =
                isInvocationByIndex || type === "invocation" || classifyStep(step) === "invocation"
            if (!isInvocation) return false

            const outputs =
                step?.outputs ??
                step?.output ??
                step?.response ??
                step?.result ??
                step?.data?.outputs ??
                step?.data?.output ??
                step?.payload?.outputs ??
                step?.payload?.output ??
                null
            const trace =
                step?.traceId ||
                step?.trace_id ||
                step?.trace ||
                step?.response?.tree ||
                step?.data?.outputs?.trace
            const hasResultPayload =
                step?.result ||
                step?.response ||
                step?.data?.result ||
                step?.data?.response ||
                step?.payload?.result ||
                step?.payload?.response
            const hasLinkingIds = Boolean((step as any)?.traceId || (step as any)?.trace_id)
            const hasTestcase = Boolean((step as any)?.testcaseId || (step as any)?.testcase_id)
            // If runIndex exists, trust its keys; otherwise fall back to the data-based checks
            if (invocationKeysFromIndex.size) {
                return invocationKeysFromIndex.has(key)
            }
            return Boolean(outputs || trace || hasResultPayload || (hasLinkingIds && hasTestcase))
        })
    }, [scenarioStepsQuery?.data?.invocationSteps, steps, runIndex])
    const primaryInvocation = invocationSteps[0]
    // Get trace directly from the primary invocation step data
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

    const annotationSteps = useMemo(() => {
        const base =
            scenarioStepsQuery?.data?.annotationSteps &&
            scenarioStepsQuery.data.annotationSteps.length
                ? scenarioStepsQuery.data.annotationSteps
                : steps

        const annotationKeysFromIndex = new Set<string>()
        if (runIndex?.steps) {
            Object.values(runIndex.steps).forEach((meta: any) => {
                if (meta?.kind === "annotation" && meta?.key) {
                    annotationKeysFromIndex.add(String(meta.key))
                }
            })
        }

        return base.filter((step) => {
            const keyRaw = step?.stepKey || step?.step_key || step?.key || ""
            const key = String(keyRaw)
            const type = (
                step?.type ||
                step?.kind ||
                step?.stepType ||
                step?.step_type ||
                ""
            ).toLowerCase()

            const isAnnotationByIndex = annotationKeysFromIndex.size
                ? annotationKeysFromIndex.has(key)
                : false

            const isAnnotation =
                isAnnotationByIndex || type === "annotation" || classifyStep(step) === "annotation"
            if (!isAnnotation) return false

            // Keep if it looks like an annotation payload
            const hasEvaluator = Boolean(step?.references?.evaluator)
            const hasOutputs =
                step?.annotation ||
                step?.annotations ||
                step?.data?.annotations ||
                step?.payload?.annotations ||
                step?.data?.outputs ||
                step?.data?.output

            if (annotationKeysFromIndex.size) {
                return annotationKeysFromIndex.has(key)
            }
            return Boolean(hasEvaluator || hasOutputs)
        })
    }, [scenarioStepsQuery?.data?.annotationSteps, steps, runIndex])

    const isLoadingScenarios = rows.length === 0 && paginationInfo.isFetching
    const isLoadingSteps =
        (scenarioStepsQuery?.status === "pending" || scenarioStepsQuery?.status === "loading") &&
        !scenarioStepsQuery?.data

    const ColumnValueView = ({column}: {column: EvaluationTableColumn}) => {
        const {selection, showSkeleton} = useScenarioCellValue({
            scenarioId: activeId ?? undefined,
            runId: effectiveRunId,
            column,
            disableVisibilityTracking: true,
        })
        const {value, displayValue} = selection

        const chatNodes = useMemo(
            () =>
                renderScenarioChatMessages(
                    value,
                    `${activeId ?? "scenario"}-${column.id ?? column.path ?? "col"}`,
                ),
            [activeId, column.id, column.path, value],
        )

        if (showSkeleton) {
            return <Typography.Text type="secondary">Loading…</Typography.Text>
        }
        const resolved = (displayValue ?? value) as any
        if (resolved === null || typeof resolved === "undefined") {
            return <Typography.Text type="secondary">—</Typography.Text>
        }

        if (chatNodes && chatNodes.length) {
            return <div className="flex w-full flex-col gap-2">{chatNodes}</div>
        }

        if (
            typeof resolved === "string" ||
            typeof resolved === "number" ||
            typeof resolved === "boolean"
        ) {
            return <Typography.Text>{String(resolved)}</Typography.Text>
        }
        return (
            <pre className="whitespace-pre-wrap break-words bg-[#F8FAFC] rounded-lg p-3 max-h-80 overflow-auto border border-[#EAECF0]">
                {JSON.stringify(resolved, null, 2)}
            </pre>
        )
    }

    const getTraceTree = (step: any) => {
        const candidate =
            step?.trace ??
            step?.traceData ??
            step?.trace_data ??
            step?.data?.trace ??
            step?.data?.outputs?.trace ??
            step?.response?.tree ??
            step?.result?.trace ??
            step?.result?.response?.tree ??
            primaryInvocationTrace ??
            null
        if (!candidate) return null
        if (candidate?.nodes) return candidate
        return {nodes: [candidate]}
    }

    const getTraceIdForStep = (step: any) => {
        const directCandidates = [
            step?.traceId,
            step?.trace_id,
            step?.trace?.trace_id,
            step?.trace?.id,
            step?.traceData?.trace_id,
            step?.trace_data?.trace_id,
            step?.data?.trace_id,
            step?.data?.trace?.id,
            step?.data?.trace_id,
            step?.response?.trace_id,
            step?.result?.trace_id,
            step?.result?.response?.trace_id,
            primaryInvocationTrace?.tree?.id,
        ].filter(Boolean)

        if (directCandidates.length) {
            return String(directCandidates[0])
        }

        const tree = getTraceTree(step)
        if (!tree) return null

        const treeId =
            tree?.tree?.id ??
            (typeof tree?.tree === "string" ? tree.tree : null) ??
            (tree as any)?.id ??
            null
        if (treeId) return String(treeId)

        const firstNode = (() => {
            if (Array.isArray((tree as any).nodes)) {
                return (tree as any).nodes[0]
            }
            const nodeValues = Object.values((tree as any).nodes ?? {})
            if (nodeValues.length) {
                const candidate = nodeValues[0] as any
                if (Array.isArray(candidate)) return candidate[0]
                return candidate
            }
            return null
        })()

        const nodeTraceId =
            firstNode?.trace_id ??
            firstNode?.traceId ??
            firstNode?.node?.trace_id ??
            firstNode?.node?.id ??
            null

        return nodeTraceId ? String(nodeTraceId) : null
    }

    const renderStepContent = (step: any, includeTraceUtils = false) => {
        const inputs =
            step?.inputs ??
            step?.input ??
            step?.groundTruth ??
            step?.testcase ??
            step?.data?.inputs ??
            step?.data?.input ??
            step?.payload?.inputs ??
            step?.payload?.input ??
            null
        const outputs =
            step?.outputs ??
            step?.output ??
            step?.response ??
            step?.result ??
            step?.data?.outputs ??
            step?.data?.output ??
            step?.payload?.outputs ??
            step?.payload?.output ??
            step?.data ??
            null
        const tree = getTraceTree(step)

        const renderBlock = (label: string, value: any) => {
            const display =
                typeof value === "string"
                    ? value
                    : value
                      ? JSON.stringify(value, null, 2)
                      : "No content"
            return (
                <div className="flex flex-col gap-2">
                    <Typography.Text type="secondary">{label}</Typography.Text>
                    <pre className="whitespace-pre-wrap break-words bg-[#F8FAFC] rounded-lg p-3 max-h-80 overflow-auto border border-[#EAECF0]">
                        {display}
                    </pre>
                </div>
            )
        }

        return (
            <div className="flex flex-col gap-3">
                {inputs ? renderBlock("Inputs", inputs) : null}
                {outputs ? renderBlock("Outputs", outputs) : null}
                {includeTraceUtils && tree ? (
                    <SharedGenerationResultUtils
                        className="!mt-1"
                        traceId={getTraceIdForStep(step)}
                        showStatus={false}
                    />
                ) : null}
                {!inputs && !outputs ? (
                    <Typography.Text type="secondary">No content</Typography.Text>
                ) : null}
            </div>
        )
    }

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

    const extractOutputs = (step: any) =>
        step?.outputs ??
        step?.output ??
        step?.response ??
        step?.result ??
        step?.data?.outputs ??
        step?.data?.output ??
        step?.payload?.outputs ??
        step?.payload?.output ??
        null

    const traceIds = useMemo(
        () =>
            invocationSteps.map((step) => step?.traceId).filter((id): id is string => Boolean(id)),
        [invocationSteps],
    )
    const traceIdsKey = useMemo(() => traceIds.join("|"), [traceIds])

    const annotationsQueryAtom = useMemo(
        () => scenarioAnnotationsQueryAtomFamily({traceIds, runId: effectiveRunId}),
        [traceIdsKey, effectiveRunId],
    )
    const annotationsQuery = useAtomValue(annotationsQueryAtom)

    const existingAnnotations = annotationsQuery?.data?.length
        ? annotationsQuery.data
        : (annotationSteps
              .map((step: any) => step?.annotation ?? step?.annotations ?? step?.data?.annotations)
              .filter(Boolean) as any[])

    const [annotationMetrics, setAnnotationMetrics] = useState<Record<string, any>>({})
    const [annotationErrors, setAnnotationErrors] = useState<string[]>([])
    const [localAnnotations, setLocalAnnotations] = useState<any[]>([])

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

    const evaluatorQuery = useAtomValue(
        useMemo(
            () => evaluationEvaluatorsByRunQueryAtomFamily(effectiveRunId ?? null),
            [effectiveRunId],
        ),
    )

    const evaluatorDtos = useMemo(() => {
        const list = (evaluatorQuery?.data || EMPTY_ARRAY) as any[]
        return list.map((e: any) => e?.raw ?? e).filter(Boolean)
    }, [evaluatorQuery])

    const annotationsForAnnotate = useMemo(
        () => [...combinedAnnotations],
        [combinedAnnotations, evaluatorQuery?.data],
    )

    const selectedEvaluators = useMemo(
        () =>
            evaluatorDtos
                .map((e: any) => e.slug)
                .filter((slug: any) => Boolean(slug) && !annotatedSlugs.has(slug)),
        [evaluatorDtos, annotatedSlugs],
    )

    const baselineMetricsRaw = useMemo(() => {
        try {
            const result = getInitialMetricsFromAnnotations({
                annotations: combinedAnnotations ?? [],
                evaluators: evaluatorDtos as any[],
            })
            console.log("[ANNOTATE_DEBUG] getInitialMetricsFromAnnotations result:", {
                combinedAnnotationsCount: combinedAnnotations?.length,
                combinedAnnotations: combinedAnnotations?.map((a) => ({
                    slug: a?.references?.evaluator?.slug,
                    outputs: a?.data?.outputs,
                })),
                evaluatorDtosCount: evaluatorDtos?.length,
                evaluatorSlugs: evaluatorDtos?.map((e: any) => e?.slug),
                resultKeys: Object.keys(result),
                result,
            })
            return result
        } catch (e) {
            console.error("[ANNOTATE_DEBUG] getInitialMetricsFromAnnotations error:", e)
            return {}
        }
    }, [combinedAnnotations, evaluatorDtos])

    // Stabilize reference to avoid infinite loops
    const baselineMetricsKey = useMemo(
        () => JSON.stringify(baselineMetricsRaw),
        [baselineMetricsRaw],
    )
    const baselineMetrics = useMemo(() => baselineMetricsRaw, [baselineMetricsKey])

    // Reset local annotations when scenario changes
    useEffect(() => {
        console.log("[ANNOTATE_DEBUG] Resetting local state for activeId:", activeId)
        setLocalAnnotations([])
        setAnnotationErrors([])
    }, [activeId])

    // Sync annotation metrics with baseline - always keep in sync
    useEffect(() => {
        console.log("[ANNOTATE_DEBUG] Sync effect - baselineMetrics:", {
            baselineMetricsKeys: Object.keys(baselineMetrics),
            baselineMetrics,
        })
        setAnnotationMetrics((prev) => {
            const isEqual = deepEqual(prev, baselineMetrics)
            console.log("[ANNOTATE_DEBUG] setAnnotationMetrics:", {
                prevKeys: Object.keys(prev),
                baselineKeys: Object.keys(baselineMetrics),
                isEqual,
                willUpdate: !isEqual,
            })
            if (isEqual) return prev
            return baselineMetrics
        })
    }, [baselineMetrics])

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
        invocationSteps.some((step) => Boolean(extractOutputs(step))) || outputColumns.length > 0

    const scenarioStatus = scenarioRow?.status
    const scenarioStatusColor = useMemo(() => {
        const status = scenarioStatus?.toLowerCase?.()
        if (!status) return "default"
        if (["success", "succeeded", "completed"].includes(status)) return "success"
        if (["failed", "error"].includes(status)) return "error"
        if (["running", "in_progress", "pending"].includes(status)) return "processing"
        return "default"
    }, [scenarioStatus])

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
                <div className="w-full p-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <ScenarioNavigator
                            runId={effectiveRunId}
                            scenarioId={activeId}
                            onChange={handleScenarioChange}
                            showScenarioIdTag={false}
                        />
                        <div className="flex items-center gap-2 text-xs">
                            {scenarioStatus ? (
                                <Tag color={scenarioStatusColor} className="m-0">
                                    {scenarioStatus}
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

                <div className="flex min-h-0 flex-col gap-3 w-full">
                    <div className="flex gap-3 w-full">
                        {/* <div className="grid grid-cols-1 md:grid-cols-2 gap-3"> */}
                        <div className="flex flex-col gap-3 shrink min-w-0 grow">
                            <Card title="Inputs">
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
                                                <ColumnValueView column={column} />
                                            </div>
                                        ))}
                                    </div>
                                ) : inputSteps.length ? (
                                    <div className="flex flex-col gap-4">
                                        {inputSteps.map((step) => (
                                            <div
                                                key={step.id ?? step.stepKey ?? step.key}
                                                className="flex flex-col gap-2"
                                            >
                                                <Typography.Text strong>
                                                    {step.stepKey ?? step.key ?? "Input"}
                                                </Typography.Text>
                                                {renderStepContent(step)}
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <Typography.Text type="secondary">
                                        No input data.
                                    </Typography.Text>
                                )}
                            </Card>

                            <Card title="Output">
                                {!columnResult ? (
                                    <Typography.Text type="secondary">
                                        Loading invocation…
                                    </Typography.Text>
                                ) : outputColumns.length ? (
                                    <div className="flex flex-col gap-4">
                                        {outputColumns.map((column) => (
                                            <div key={column.id} className="flex flex-col gap-2">
                                                <ColumnValueView column={column} />
                                            </div>
                                        ))}
                                        {invocationSteps.length
                                            ? (() => {
                                                  const traceId = getTraceIdForStep(
                                                      invocationSteps[0],
                                                  )
                                                  if (!traceId) return null
                                                  return (
                                                      <SharedGenerationResultUtils
                                                          className="!mt-1"
                                                          traceId={traceId}
                                                          showStatus={false}
                                                      />
                                                  )
                                              })()
                                            : null}
                                    </div>
                                ) : invocationSteps.length ? (
                                    <div className="flex flex-col gap-4">
                                        {invocationSteps.map((step) => (
                                            <div
                                                key={step.id ?? step.stepKey ?? step.key}
                                                className="flex flex-col gap-2"
                                            >
                                                {renderStepContent(step, true)}
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

                        <div className="flex grow w-full max-w-[400px]">
                            <Card
                                title="Annotations"
                                className="w-full"
                                classNames={{
                                    body: "!p-2",
                                }}
                            >
                                {hasInvocationOutput ? (
                                    <div className="flex flex-col gap-3">
                                        {annotationsQuery?.isFetching ? (
                                            <Typography.Text type="secondary">
                                                Loading annotations…
                                            </Typography.Text>
                                        ) : (
                                            <>
                                                {console.log(
                                                    "[ANNOTATE_DEBUG] Rendering Annotate with:",
                                                    {
                                                        annotationsForAnnotateCount:
                                                            annotationsForAnnotate?.length,
                                                        annotationsForAnnotate:
                                                            annotationsForAnnotate?.map(
                                                                (a: any) => ({
                                                                    slug: a?.references?.evaluator
                                                                        ?.slug,
                                                                    outputs: a?.data?.outputs,
                                                                }),
                                                            ),
                                                        annotationMetricsKeys:
                                                            Object.keys(annotationMetrics),
                                                        annotationMetrics,
                                                        selectedEvaluators,
                                                    },
                                                )}
                                                <Annotate
                                                    annotations={annotationsForAnnotate}
                                                    updatedMetrics={annotationMetrics}
                                                    setUpdatedMetrics={setAnnotationMetrics}
                                                    selectedEvaluators={selectedEvaluators}
                                                    errorMessage={annotationErrors}
                                                    disabled={!hasInvocationOutput}
                                                />
                                            </>
                                        )}
                                        <div className="flex items-center justify-between">
                                            <Button
                                                type="primary"
                                                className="w-full"
                                                disabled={
                                                    !hasPendingAnnotationChanges ||
                                                    annotationsQuery?.isFetching
                                                }
                                                onClick={() => {
                                                    const changedEntries = Object.entries(
                                                        annotationMetrics ?? {},
                                                    ).filter(([slug, fields]) => {
                                                        const baseline =
                                                            (baselineMetrics as any)?.[slug] || {}
                                                        return Object.entries(fields || {}).some(
                                                            ([key, field]) => {
                                                                const nextVal = (field as any)
                                                                    ?.value
                                                                const prevVal = (baseline as any)?.[
                                                                    key
                                                                ]?.value
                                                                return !deepEqual(prevVal, nextVal)
                                                            },
                                                        )
                                                    })
                                                    if (!changedEntries.length) return
                                                    const traceId = traceIds[0] ?? "local-trace"
                                                    const next = changedEntries.map(
                                                        ([slug, fields]) => ({
                                                            id: `local-${slug}-${Date.now()}`,
                                                            data: {
                                                                outputs: {
                                                                    metrics: Object.fromEntries(
                                                                        Object.entries(
                                                                            fields || {},
                                                                        ).map(([key, field]) => [
                                                                            key,
                                                                            (field as any)?.value,
                                                                        ]),
                                                                    ),
                                                                },
                                                            },
                                                            references: {
                                                                evaluator: {slug},
                                                                invocation: {trace_id: traceId},
                                                            },
                                                        }),
                                                    )
                                                    setLocalAnnotations((prev) => {
                                                        const filtered = prev.filter((ann) => {
                                                            const slug =
                                                                ann?.references?.evaluator?.slug
                                                            return !next.some(
                                                                (n) =>
                                                                    n.references?.evaluator
                                                                        ?.slug === slug,
                                                            )
                                                        })
                                                        return [...filtered, ...next]
                                                    })
                                                    setAnnotationMetrics({})
                                                }}
                                            >
                                                Annotate
                                            </Button>
                                        </div>
                                    </div>
                                ) : (
                                    <Typography.Text type="secondary">
                                        To annotate, please generate output.
                                    </Typography.Text>
                                )}
                            </Card>
                        </div>
                    </div>
                </div>
            </div>
        </section>
    )
}

export default memo(SingleScenarioViewerPOC)
