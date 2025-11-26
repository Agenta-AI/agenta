import {memo, useCallback, useEffect, useMemo, useState} from "react"

import {Button, Card, Typography} from "antd"
import deepEqual from "fast-deep-equal"
import {useAtom, useAtomValue} from "jotai"
import dynamic from "next/dynamic"
import {useRouter} from "next/router"

import {useInfiniteTablePagination} from "@/oss/components/InfiniteVirtualTable"
import {getInitialMetricsFromAnnotations} from "@/oss/components/pages/observability/drawer/AnnotateDrawer/assets/transforms"
import {useRunId} from "@/oss/contexts/RunIdContext"

import {scenarioAnnotationsQueryAtomFamily} from "../../atoms/annotations"
import {scenarioStepsQueryFamily} from "../../atoms/scenarioSteps"
import type {EvaluationTableColumn} from "../../atoms/table"
import {evaluationEvaluatorsByRunQueryAtomFamily} from "../../atoms/table/evaluators"
import {evaluationPreviewTableStore} from "../../evaluationPreviewTableStore"
import usePreviewTableData from "../../hooks/usePreviewTableData"
import {useScenarioStepValue} from "../../hooks/useScenarioStepValue"
import {pocUrlStateAtom} from "../../state/urlState"

import ScenarioLoadingIndicator from "./SingleScenarioViewerPOC/ScenarioLoadingIndicator"
import ScenarioNavigator from "./SingleScenarioViewerPOC/ScenarioNavigator"

const Annotate = dynamic(
    () =>
        import(
            "@agenta/oss/src/components/pages/observability/drawer/AnnotateDrawer/assets/Annotate"
        ),
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
    const effectiveRunId = useRunId() || runId
    const {rows, paginationInfo, loadNextPage} = useInfiniteTablePagination({
        store: evaluationPreviewTableStore,
        scopeId: effectiveRunId,
        pageSize: 50,
    })

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

    let inputSteps =
        scenarioStepsQuery?.data?.inputSteps && scenarioStepsQuery.data.inputSteps.length
            ? [...scenarioStepsQuery.data.inputSteps]
            : []
    if (!inputSteps.length && scenarioStepsQuery?.data?.inputStep) {
        inputSteps = [scenarioStepsQuery.data.inputStep as any]
    }
    if (!inputSteps.length) {
        inputSteps.push(...steps.filter((step) => classifyStep(step) === "input"))
    }

    const invocationSteps =
        scenarioStepsQuery?.data?.invocationSteps && scenarioStepsQuery.data.invocationSteps.length
            ? scenarioStepsQuery.data.invocationSteps
            : steps.filter((step) => classifyStep(step) === "invocation")

    const annotationSteps =
        scenarioStepsQuery?.data?.annotationSteps && scenarioStepsQuery.data.annotationSteps.length
            ? scenarioStepsQuery.data.annotationSteps
            : steps.filter((step) => classifyStep(step) === "annotation")

    const isLoadingScenarios = rows.length === 0 && paginationInfo.isFetching
    const isLoadingSteps =
        (scenarioStepsQuery?.status === "pending" || scenarioStepsQuery?.status === "loading") &&
        !scenarioStepsQuery?.data

    const ColumnValueView = ({column}: {column: EvaluationTableColumn}) => {
        const {value, displayValue, isLoading, error} = useScenarioStepValue(
            {scenarioId: activeId ?? undefined, runId: effectiveRunId, column},
            {enabled: Boolean(activeId)},
        )
        if (isLoading) {
            return <Typography.Text type="secondary">Loading…</Typography.Text>
        }
        if (error) {
            return <Typography.Text type="secondary">—</Typography.Text>
        }
        const resolved = (displayValue ?? value) as any
        if (resolved === null || typeof resolved === "undefined") {
            return <Typography.Text type="secondary">—</Typography.Text>
        }
        if (
            typeof resolved === "string" ||
            typeof resolved === "number" ||
            typeof resolved === "boolean"
        ) {
            return <Typography.Text>{String(resolved)}</Typography.Text>
        }
        return (
            <pre className="whitespace-pre-wrap break-words text-sm bg-[#F8FAFC] rounded-lg p-3 max-h-80 overflow-auto border border-[#EAECF0]">
                {JSON.stringify(resolved, null, 2)}
            </pre>
        )
    }

    const renderStepContent = (step: any) => {
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
                    <pre className="whitespace-pre-wrap break-words text-sm bg-[#F8FAFC] rounded-lg p-3 max-h-80 overflow-auto border border-[#EAECF0]">
                        {display}
                    </pre>
                </div>
            )
        }

        return (
            <div className="flex flex-col gap-3">
                {inputs ? renderBlock("Inputs", inputs) : null}
                {outputs ? renderBlock("Outputs", outputs) : null}
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
              .map((step) => step?.annotation ?? step?.annotations ?? step?.data?.annotations)
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
            return baselineMetrics
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
        invocationSteps.some((step) => Boolean(extractOutputs(step))) || outputColumns.length > 0

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
                <ScenarioNavigator
                    runId={effectiveRunId}
                    scenarioId={activeId}
                    onChange={handleScenarioChange}
                />

                <div className="flex min-h-0 flex-col gap-3 w-full">
                    <Card
                        title={
                            <Typography.Title level={5} className="!mb-0 text-[#1D2939]">
                                {scenarioRow?.scenarioIndex
                                    ? `Scenario #${scenarioRow.scenarioIndex}`
                                    : "Scenario"}
                            </Typography.Title>
                        }
                        className="w-full"
                    >
                        <div className="flex flex-col gap-2">
                            <Typography.Text type="secondary">Scenario ID</Typography.Text>
                            <Typography.Text code>{activeId}</Typography.Text>
                            {scenarioRow?.status ? (
                                <Typography.Text>Status: {scenarioRow.status}</Typography.Text>
                            ) : null}
                        </div>
                    </Card>

                    <div className="flex gap-3 w-full">
                        {/* <div className="grid grid-cols-1 md:grid-cols-2 gap-3"> */}
                        <div className="flex flex-col gap-3 shrink min-w-0">
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
                                    </div>
                                ) : invocationSteps.length ? (
                                    <div className="flex flex-col gap-4">
                                        {invocationSteps.map((step) => (
                                            <div
                                                key={step.id ?? step.stepKey ?? step.key}
                                                className="flex flex-col gap-2"
                                            >
                                                {renderStepContent(step)}
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
                            <Card title="Annotations" className="w-full">
                                {hasInvocationOutput ? (
                                    <div className="flex flex-col gap-3">
                                        {annotationsQuery?.isFetching ? (
                                            <Typography.Text type="secondary">
                                                Loading annotations…
                                            </Typography.Text>
                                        ) : (
                                            <Annotate
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
