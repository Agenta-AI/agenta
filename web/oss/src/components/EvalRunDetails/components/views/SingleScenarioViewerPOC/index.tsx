import {memo, useCallback, useEffect, useMemo, useRef} from "react"

import {Card, Tag, Typography} from "antd"
import {useAtom, useAtomValue, useSetAtom} from "jotai"
import dynamic from "next/dynamic"
import {useRouter} from "next/router"

import {useInfiniteTablePagination} from "@/oss/components/InfiniteVirtualTable"

import {scenarioAnnotationsQueryAtomFamily} from "../../../atoms/annotations"
import {runningInvocationsAtom, triggerRunInvocationAtom} from "../../../atoms/runInvocationAction"
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
const INVOCATION_SUCCESS_STATUSES = new Set(["success", "succeeded", "completed", "done"])
const INVOCATION_IN_FLIGHT_STATUSES = new Set(["running", "in_progress"])

const SingleScenarioViewerPOC = ({runId}: SingleScenarioViewerPOCProps) => {
    const router = useRouter()
    const [urlState, setUrlState] = useAtom(pocUrlStateAtom)

    // Run invocation action
    const runningInvocations = useAtomValue(runningInvocationsAtom)
    const triggerRunInvocation = useSetAtom(triggerRunInvocationAtom)

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

    const hasInputDataReady = useMemo(() => {
        if (!inputSteps.length) return false
        return inputSteps.some((step: any) => {
            const testcaseId = step?.testcaseId ?? step?.testcase_id
            if (testcaseId) return true
            const inputs = step?.inputs ?? step?.data
            return inputs && Object.keys(inputs).length > 0
        })
    }, [inputSteps])

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

    // Annotations - collect trace IDs from both annotation steps AND invocation steps
    // This ensures we can fetch annotations even before annotation steps exist
    const traceIds = useMemo(() => {
        const ids = new Set<string>()

        // Add trace IDs from annotation steps
        annotationSteps.forEach((step: any) => {
            const traceId = step?.traceId ?? step?.trace_id
            if (traceId) ids.add(traceId)
        })

        // Add trace IDs from invocation steps (annotations are linked to these)
        invocationSteps.forEach((step: any) => {
            const traceId = step?.traceId ?? step?.trace_id
            if (traceId) ids.add(traceId)
        })

        return Array.from(ids)
    }, [annotationSteps, invocationSteps])
    const traceIdsKey = useMemo(() => traceIds.join("|"), [traceIds])

    const annotationsQueryAtom = useMemo(
        () => scenarioAnnotationsQueryAtomFamily({traceIds, runId}),
        [traceIdsKey, runId],
    )
    const annotationsQuery = useAtomValue(annotationsQueryAtom)

    // Use ref to preserve previous annotations during refetch (within same scenario only)
    const prevAnnotationsRef = useRef<{activeId: string | null; annotations: any[]}>({
        activeId: null,
        annotations: [],
    })

    const existingAnnotations = useMemo(() => {
        // Clear cache if activeId changed to prevent stale annotations from previous scenario
        if (prevAnnotationsRef.current.activeId !== activeId) {
            prevAnnotationsRef.current = {activeId, annotations: []}
        }

        const fromQuery = annotationsQuery?.data?.length ? annotationsQuery.data : null
        const fromSteps = annotationSteps
            .map((step: any) => step?.annotation ?? step?.annotations ?? step?.data?.annotations)
            .filter(Boolean) as any[]

        const result = fromQuery ?? fromSteps

        // If we have new data, update the ref
        // If result is empty but we had previous data, return previous to prevent flash
        if (result.length > 0) {
            prevAnnotationsRef.current = {activeId, annotations: result}
            return result
        } else if (prevAnnotationsRef.current.annotations.length > 0) {
            // Keep previous annotations during refetch to prevent UI flash
            return prevAnnotationsRef.current.annotations
        }

        return result
    }, [annotationsQuery?.data, annotationSteps, activeId])

    // Evaluators
    const evaluatorQuery = useAtomValue(
        useMemo(() => evaluationEvaluatorsByRunQueryAtomFamily(runId ?? null), [runId]),
    )

    const evaluatorDtos = useMemo(() => {
        const list = (evaluatorQuery?.data || EMPTY_ARRAY) as any[]
        return list.map((e: any) => e?.raw ?? e).filter(Boolean)
    }, [evaluatorQuery])

    const hasInvocationOutput =
        invocationSteps.some((step) => Boolean(extractOutputs(step))) || outputColumns.length > 0

    // Check if all invocations are successful
    const allInvocationsSuccessful = useMemo(() => {
        if (invocationSteps.length === 0) return false
        return invocationSteps.every((step) =>
            INVOCATION_SUCCESS_STATUSES.has(normalizeStatus(step.status)),
        )
    }, [invocationSteps])

    const hasInvocationTrace = useMemo(() => {
        if (!invocationSteps.length) return false
        return invocationSteps.some((step) =>
            Boolean(
                step?.traceId ||
                step?.trace_id ||
                step?.trace ||
                step?.traceData ||
                step?.trace_data,
            ),
        )
    }, [invocationSteps])

    // Find the first pending (non-successful) invocation step key for the Run button
    const pendingInvocationStepKey = useMemo(() => {
        if (!runIndex?.invocationKeys) return null
        const invocationKeys = Array.from(runIndex.invocationKeys)
        for (const key of invocationKeys) {
            const step = invocationSteps.find((s) => (s.stepKey ?? s.step_key) === key)
            if (!step) return key
            const status = normalizeStatus(step.status)
            if (INVOCATION_IN_FLIGHT_STATUSES.has(status)) return null
            if (!INVOCATION_SUCCESS_STATUSES.has(status)) return key
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

    // Track which scenario we've already initiated auto-run for
    // This prevents re-triggering after cache invalidation/refetch cycles
    const autoRunInitiatedRef = useRef<string | null>(null)

    // Auto-run invocation when a new scenario is opened and needs invocation
    // This eliminates the need for users to manually click "Run" each time
    useEffect(() => {
        // Skip if no scenario selected or no pending invocation needed
        if (!activeId || !pendingInvocationStepKey) return

        // Skip if we've already initiated auto-run for this scenario
        // This prevents re-triggering after cache invalidation/refetch cycles
        if (autoRunInitiatedRef.current === activeId) return

        // Skip if scenario steps data is still loading
        // This prevents triggering before input data (testcase IDs) is available
        if (scenarioStepsQuery?.status !== "success") return

        // Skip if we don't have input steps yet (data not fully loaded)
        // Input steps contain the testcase IDs needed to fetch input data for the invocation
        if (!hasInputDataReady) return

        // Skip if an invocation trace already exists (likely running or completed)
        if (hasInvocationTrace) return

        // Skip if already running to prevent duplicate triggers
        if (isRunningInvocation) return

        // Mark that we've initiated auto-run for this scenario
        autoRunInitiatedRef.current = activeId

        // Auto-trigger the run
        handleRunInvocation()
    }, [
        activeId,
        pendingInvocationStepKey,
        scenarioStepsQuery?.status,
        hasInputDataReady,
        hasInvocationTrace,
        isRunningInvocation,
        handleRunInvocation,
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
            <div className="flex w-full min-h-0 flex-col gap-3 px-3 overflow-hidden">
                {/* Header */}
                <div className="w-full p-3 shrink-0">
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
                <div className="flex-1 min-h-0 overflow-y-auto w-full pb-3">
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
