import {useCallback, useEffect, useMemo, type ReactNode} from "react"

import {
    TestcaseDataEditor,
    TestcaseDrawer,
    useTestcaseDrawerNavigation,
    type TestcaseDrawerContentRenderProps,
} from "@agenta/entity-ui/testcase"
import {useAtomValue, useSetAtom} from "jotai"

import {
    useInfiniteTablePagination,
    type InfiniteTableStore,
} from "@/oss/components/InfiniteVirtualTable"

import {scenarioStepsQueryFamily} from "../../atoms/scenarioSteps"
import {
    scenarioTestcaseEntityAtomFamily,
    scenarioTestcaseIdAtomFamily,
    scenarioTestcaseMetaAtomFamily,
} from "../../atoms/scenarioTestcase"
import type {EvaluationTableColumn} from "../../atoms/table"
import type {PreviewTableRow} from "../../atoms/tableRows"
import {evaluationPreviewTableStore} from "../../evaluationPreviewTableStore"
import usePreviewTableData from "../../hooks/usePreviewTableData"
import {
    closeFocusDrawerAtom,
    focusScenarioAtom,
    isFocusDrawerOpenAtom,
    resetFocusDrawerAtom,
} from "../../state/focusDrawerAtom"
import {clearFocusDrawerQueryParams, patchFocusDrawerQueryParams} from "../../state/urlFocusDrawer"

import {buildEvaluationDrawerPayload} from "./drawerPayload"
import EvaluatorMetricsAdapter, {useEvaluatorMetricDrawerData} from "./EvaluatorMetricsAdapter"
import InvocationOutputsAdapter, {useInvocationOutputDrawerData} from "./InvocationOutputsAdapter"
import {
    buildEvalDrawerItemIdentity,
    extractEmbeddedInputValue,
    mapEvalInputColumns,
    mapEvalMetricSections,
    mapEvalOutputSections,
} from "./model"

const PAGE_SIZE = 50
type PreviewPaginationRow = PreviewTableRow & Record<string, unknown>

const getScenarioRowId = (row: PreviewPaginationRow) => row.scenarioId ?? null

const EvalTestcaseDrawerAdapter = () => {
    const open = useAtomValue(isFocusDrawerOpenAtom)
    const focus = useAtomValue(focusScenarioAtom)
    const closeDrawer = useSetAtom(closeFocusDrawerAtom)
    const resetDrawer = useSetAtom(resetFocusDrawerAtom)

    const runId = focus?.focusRunId ?? null
    const scenarioId = focus?.focusScenarioId ?? null

    const {columnResult, columnsPending} = usePreviewTableData({runId: runId ?? ""})
    const stepsQuery = useAtomValue(
        useMemo(
            () => scenarioStepsQueryFamily({scenarioId: scenarioId ?? "", runId}),
            [runId, scenarioId],
        ),
    )
    const sourceTestcaseId = useAtomValue(
        useMemo(
            () => scenarioTestcaseIdAtomFamily({scenarioId: scenarioId ?? "", runId}),
            [runId, scenarioId],
        ),
    )
    const testcaseData = useAtomValue(
        useMemo(
            () => scenarioTestcaseEntityAtomFamily({scenarioId: scenarioId ?? "", runId}),
            [runId, scenarioId],
        ),
    )
    const testcaseMeta = useAtomValue(
        useMemo(
            () => scenarioTestcaseMetaAtomFamily({scenarioId: scenarioId ?? "", runId}),
            [runId, scenarioId],
        ),
    )

    const {rows, paginationInfo, loadNextPage} = useInfiniteTablePagination<PreviewPaginationRow>({
        store: evaluationPreviewTableStore as unknown as InfiniteTableStore<
            PreviewPaginationRow,
            unknown
        >,
        scopeId: runId,
        pageSize: PAGE_SIZE,
    })

    const loadedScenarios = useMemo(
        () =>
            rows
                .filter((row) => !row.__isSkeleton && row.scenarioId)
                .sort(
                    (a, b) =>
                        (a.scenarioIndex ?? Number.MAX_SAFE_INTEGER) -
                        (b.scenarioIndex ?? Number.MAX_SAFE_INTEGER),
                ),
        [rows],
    )

    const inputColumns = useMemo(() => {
        const columnMap = new Map<string, EvaluationTableColumn>()
        columnResult?.columns.forEach((column) => columnMap.set(column.id, column))

        const inputGroup = columnResult?.groups.find((group) => group.kind === "input")
        if (!inputGroup) return []

        return inputGroup.columnIds
            .map((columnId) => columnMap.get(columnId))
            .filter((column): column is EvaluationTableColumn => Boolean(column))
    }, [columnResult])

    const editorColumns = useMemo(() => mapEvalInputColumns(inputColumns), [inputColumns])
    const outputSections = useMemo(
        () =>
            mapEvalOutputSections({
                groups: columnResult?.groups ?? [],
                columns: columnResult?.columns ?? [],
                steps: stepsQuery.data?.steps ?? [],
            }),
        [columnResult?.columns, columnResult?.groups, stepsQuery.data?.steps],
    )
    const metricSections = useMemo(
        () =>
            mapEvalMetricSections({
                groups: columnResult?.groups ?? [],
                columns: columnResult?.columns ?? [],
                steps: stepsQuery.data?.steps ?? [],
            }),
        [columnResult?.columns, columnResult?.groups, stepsQuery.data?.steps],
    )
    const outputData = useInvocationOutputDrawerData({
        runId: runId ?? "",
        scenarioId: scenarioId ?? "",
        sections: outputSections,
    })
    const metricData = useEvaluatorMetricDrawerData({
        runId: runId ?? "",
        scenarioId: scenarioId ?? "",
        sections: metricSections,
    })

    const identity = useMemo(() => {
        if (!scenarioId) return null
        return buildEvalDrawerItemIdentity({
            scenarioId,
            sourceTestcaseId: sourceTestcaseId ?? null,
        })
    }, [scenarioId, sourceTestcaseId])

    const inputValue = useMemo(() => {
        if (sourceTestcaseId && testcaseData) {
            return testcaseData as Record<string, unknown>
        }

        return extractEmbeddedInputValue(stepsQuery.data?.steps ?? [], inputColumns)
    }, [inputColumns, sourceTestcaseId, stepsQuery.data?.steps, testcaseData])
    const drawerPayload = useMemo(
        () =>
            buildEvaluationDrawerPayload({
                inputs: inputValue,
                outputs: outputData.value,
                evaluators: metricData.evaluators.value,
                metrics: metricData.metrics.value,
            }),
        [inputValue, metricData.evaluators.value, metricData.metrics.value, outputData.value],
    )

    const isLoading =
        columnsPending ||
        (!stepsQuery.data && (stepsQuery.isLoading || stepsQuery.isPending)) ||
        (Boolean(sourceTestcaseId) && testcaseMeta.isLoading)

    const error = testcaseMeta.error ?? stepsQuery.error

    const handleClose = useCallback(() => {
        closeDrawer()
    }, [closeDrawer])

    const handleAfterOpenChange = useCallback(
        (nextOpen: boolean) => {
            if (!nextOpen) {
                resetDrawer()
                clearFocusDrawerQueryParams()
            }
        },
        [resetDrawer],
    )

    const changeScenario = useCallback(
        (nextScenarioId: string, scenarioIndex?: number, testcaseId?: string) => {
            if (!runId) return
            patchFocusDrawerQueryParams({
                focusRunId: runId,
                focusScenarioId: nextScenarioId,
                compareMode: false,
                scenarioIndex,
                testcaseId,
            })
        },
        [runId],
    )

    const navigateToScenario = useCallback(
        (row: PreviewPaginationRow) => {
            if (!row.scenarioId) return
            changeScenario(row.scenarioId, row.scenarioIndex, row.testcaseId)
        },
        [changeScenario],
    )

    const {currentIndex, hasPrevious, hasNext, handlePrevious, handleNext} =
        useTestcaseDrawerNavigation<PreviewPaginationRow>({
            rows: loadedScenarios,
            getRowId: getScenarioRowId,
            currentRowId: scenarioId,
            onNavigate: navigateToScenario,
        })

    const currentScenario = currentIndex >= 0 ? loadedScenarios[currentIndex] : null

    const renderContent = useCallback(
        ({
            initialPath,
            onPathChange,
            rootViewMode,
            collapseSignal,
        }: TestcaseDrawerContentRenderProps): ReactNode => {
            if (rootViewMode !== "form") {
                return (
                    <div className="w-full">
                        <TestcaseDataEditor
                            value={drawerPayload}
                            mode="view"
                            surface="drawer"
                            features={{
                                typeChips: true,
                                rootViewMode: false,
                                columnMapping: false,
                            }}
                            rootViewMode={rootViewMode}
                        />
                    </div>
                )
            }

            return (
                <div className="w-full [&_.drill-in-breadcrumb]:pl-4 [&_.drill-in-field-content]:px-4 [&_.drill-in-field-content]:pt-2">
                    <TestcaseDataEditor
                        value={inputValue}
                        columns={editorColumns}
                        mode="view"
                        surface="drawer"
                        initialPath={initialPath}
                        onPathChange={onPathChange}
                        features={{
                            typeChips: true,
                            rootViewMode: false,
                            columnMapping: false,
                        }}
                        rootViewMode={rootViewMode}
                        collapseSignal={collapseSignal}
                    />
                    <InvocationOutputsAdapter
                        runId={runId ?? ""}
                        scenarioId={scenarioId ?? ""}
                        sections={outputSections}
                        rootViewMode={rootViewMode}
                        collapseSignal={collapseSignal}
                    />
                    <EvaluatorMetricsAdapter
                        runId={runId ?? ""}
                        scenarioId={scenarioId ?? ""}
                        sections={metricSections}
                        rootViewMode={rootViewMode}
                        collapseSignal={collapseSignal}
                    />
                </div>
            )
        },
        [
            drawerPayload,
            editorColumns,
            inputValue,
            metricSections,
            outputSections,
            runId,
            scenarioId,
        ],
    )

    useEffect(() => {
        if (!scenarioId) return
        const hasScenarioLoaded = loadedScenarios.some((row) => row.scenarioId === scenarioId)
        if (!hasScenarioLoaded && paginationInfo.hasMore && !paginationInfo.isFetching) {
            loadNextPage()
        }
    }, [
        scenarioId,
        loadedScenarios,
        paginationInfo.hasMore,
        paginationInfo.isFetching,
        loadNextPage,
    ])

    if (!runId || !scenarioId || !identity) {
        return null
    }

    return (
        <TestcaseDrawer
            open={open}
            onClose={handleClose}
            afterOpenChange={handleAfterOpenChange}
            testcaseId={identity.drawerItemId}
            displayId={identity.displayId}
            copyId={identity.displayId}
            isNewRow={false}
            viewOnly
            onPrevious={handlePrevious}
            onNext={handleNext}
            hasPrevious={hasPrevious}
            hasNext={hasNext}
            testcaseNumber={currentScenario?.scenarioIndex ?? focus?.scenarioIndex ?? undefined}
            testcaseData={drawerPayload}
            isLoading={isLoading}
            isError={Boolean(error)}
            errorMessage={
                error instanceof Error ? error.message : error ? String(error) : undefined
            }
            isDirty={false}
            renderContent={renderContent}
            enableRootViewMode
        />
    )
}

export default EvalTestcaseDrawerAdapter
