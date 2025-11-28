import {memo, useCallback, useEffect, useMemo, useState} from "react"

import {Button, Card, Tag, Typography} from "antd"
import deepEqual from "fast-deep-equal"
import {useAtom, useAtomValue} from "jotai"
import dynamic from "next/dynamic"
import {useRouter} from "next/router"

import {useInfiniteTablePagination} from "@/oss/components/InfiniteVirtualTable"
import {getInitialMetricsFromAnnotations} from "@/oss/components/pages/observability/drawer/AnnotateDrawer/assets/transforms"

import {scenarioAnnotationsQueryAtomFamily} from "../../../atoms/annotations"
import {scenarioStepsQueryFamily} from "../../../atoms/scenarioSteps"
import type {EvaluationTableColumn} from "../../../atoms/table"
import {evaluationEvaluatorsByRunQueryAtomFamily} from "../../../atoms/table/evaluators"
import {evaluationRunIndexAtomFamily} from "../../../atoms/table/run"
import {evaluationPreviewTableStore} from "../../../evaluationPreviewTableStore"
import usePreviewTableData from "../../../hooks/usePreviewTableData"
import {pocUrlStateAtom} from "../../../state/urlState"

import ColumnValueView from "./ColumnValueView"
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

const EMPTY_ARRAY: any[] = []
const PAGE_SIZE = 50

const SingleScenarioViewerPOC = ({runId}: SingleScenarioViewerPOCProps) => {
    const router = useRouter()
    const [urlState, setUrlState] = useAtom(pocUrlStateAtom)

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

    const existingAnnotations = useMemo(
        () =>
            annotationsQuery?.data?.length
                ? annotationsQuery.data
                : (annotationSteps
                      .map(
                          (step: any) =>
                              step?.annotation ?? step?.annotations ?? step?.data?.annotations,
                      )
                      .filter(Boolean) as any[]),
        [annotationsQuery?.data, annotationSteps],
    )

    // Local annotation state
    const [localAnnotations, setLocalAnnotations] = useState<any[]>([])
    const [annotationErrors, setAnnotationErrors] = useState<string[]>([])
    const [annotationMetrics, setAnnotationMetrics] = useState<Record<string, any>>({})

    // Reset annotation state when scenario changes
    useEffect(() => {
        setAnnotationMetrics({})
        setLocalAnnotations([])
        setAnnotationErrors([])
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

    const annotationsForAnnotate = useMemo(() => [...combinedAnnotations], [combinedAnnotations])

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

    const scenarioStatusColor = useMemo(
        () => getScenarioStatusColor(scenarioRow?.status as string | undefined),
        [scenarioRow?.status],
    )

    // Handle annotation save
    const handleAnnotationSave = useCallback(() => {
        const changedEntries = Object.entries(annotationMetrics ?? {}).filter(([slug, fields]) => {
            const baseline = (baselineMetrics as any)?.[slug] || {}
            return Object.entries(fields || {}).some(([key, field]) => {
                const nextVal = (field as any)?.value
                const prevVal = (baseline as any)?.[key]?.value
                return !deepEqual(prevVal, nextVal)
            })
        })

        if (!changedEntries.length) return

        const traceId = traceIds[0] ?? "local-trace"
        const next = changedEntries.map(([slug, fields]) => ({
            id: `local-${slug}-${Date.now()}`,
            data: {
                outputs: {
                    metrics: Object.fromEntries(
                        Object.entries(fields || {}).map(([key, field]) => [
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
        }))

        setLocalAnnotations((prev) => {
            const filtered = prev.filter((ann) => {
                const slug = ann?.references?.evaluator?.slug
                return !next.some((n) => n.references?.evaluator?.slug === slug)
            })
            return [...filtered, ...next]
        })
        setAnnotationMetrics({})
    }, [annotationMetrics, baselineMetrics, traceIds])

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
                    <div className="flex gap-3 w-full">
                        <div className="flex flex-col gap-3 shrink min-w-0 grow">
                            {/* Inputs Card */}
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
                            <Card title="Output">
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
                                                showStatus={false}
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

                        {/* Annotations Card */}
                        <div className="flex grow w-full max-w-[400px]">
                            <Card
                                title="Annotations"
                                className="w-full"
                                classNames={{body: "!p-2"}}
                            >
                                {hasInvocationOutput ? (
                                    <div className="flex flex-col gap-3">
                                        {annotationsQuery?.isFetching ? (
                                            <Typography.Text type="secondary">
                                                Loading annotations…
                                            </Typography.Text>
                                        ) : (
                                            <Annotate
                                                key={scenarioRow?.id}
                                                annotations={annotationsForAnnotate}
                                                updatedMetrics={annotationMetrics}
                                                setUpdatedMetrics={setAnnotationMetrics}
                                                selectedEvaluators={selectedEvaluators}
                                                errorMessage={annotationErrors}
                                                disabled={!hasInvocationOutput}
                                            />
                                        )}
                                        <div className="flex items-center justify-between">
                                            <Button
                                                type="primary"
                                                className="w-full"
                                                disabled={
                                                    !hasPendingAnnotationChanges ||
                                                    annotationsQuery?.isFetching
                                                }
                                                onClick={handleAnnotationSave}
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

// Re-export classifyStep for backward compatibility
export {classifyStep} from "./utils"
