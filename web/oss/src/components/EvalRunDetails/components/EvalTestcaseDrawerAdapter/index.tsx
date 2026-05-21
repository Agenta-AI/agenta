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

import {variantReferenceQueryAtomFamily} from "../../atoms/references"
import {scenarioStepsQueryFamily} from "../../atoms/scenarioSteps"
import {
    scenarioTestcaseEntityAtomFamily,
    scenarioTestcaseIdAtomFamily,
    scenarioTestcaseMetaAtomFamily,
} from "../../atoms/scenarioTestcase"
import type {EvaluationTableColumn, EvaluationTableColumnGroup} from "../../atoms/table"
import type {PreviewTableRow} from "../../atoms/tableRows"
import {evaluationPreviewTableStore} from "../../evaluationPreviewTableStore"
import usePreviewTableData from "../../hooks/usePreviewTableData"
import useRunIdentifiers from "../../hooks/useRunIdentifiers"
import {
    closeFocusDrawerAtom,
    focusScenarioAtom,
    isFocusDrawerOpenAtom,
    resetFocusDrawerAtom,
} from "../../state/focusDrawerAtom"
import {clearFocusDrawerQueryParams, patchFocusDrawerQueryParams} from "../../state/urlFocusDrawer"

import EvaluatorMetricsAdapter from "./EvaluatorMetricsAdapter"
import InvocationOutputsAdapter from "./InvocationOutputsAdapter"
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

const InvocationMetaHeader = ({
    group,
    runId,
}: {
    group: EvaluationTableColumnGroup | null
    runId: string | null
}) => {
    const runIdentifiers = useRunIdentifiers(runId)
    const applicationVariantId =
        (group?.meta?.refs?.variant?.id as string | undefined) ??
        (group?.meta?.refs?.application_variant?.id as string | undefined) ??
        runIdentifiers.variantId ??
        runIdentifiers.applicationVariantId ??
        null
    const revisionId =
        (group?.meta?.refs?.application_revision?.id as string | undefined) ??
        (group?.meta?.refs?.applicationRevision?.id as string | undefined) ??
        (runIdentifiers.rawRefs?.applicationRevision?.id as string | undefined) ??
        (runIdentifiers.rawRefs?.application_revision?.id as string | undefined) ??
        null
    const variantRevision =
        (group?.meta?.refs?.variant?.revision as string | number | undefined) ??
        (group?.meta?.refs?.variant?.version as string | number | undefined) ??
        (group?.meta?.refs?.application_variant?.revision as string | number | undefined) ??
        (group?.meta?.refs?.application_variant?.version as string | number | undefined) ??
        (runIdentifiers.rawRefs?.variant?.revision as string | number | undefined) ??
        (runIdentifiers.rawRefs?.variant?.version as string | number | undefined) ??
        null

    const variantQuery = useAtomValue(
        useMemo(
            () => variantReferenceQueryAtomFamily(revisionId ?? applicationVariantId),
            [revisionId, applicationVariantId],
        ),
    )

    const resolvedVariantRevision =
        variantQuery.data?.revision !== undefined && variantQuery.data?.revision !== null
            ? String(variantQuery.data.revision)
            : variantRevision !== undefined && variantRevision !== null
              ? String(variantRevision)
              : null
    const revisionBadge =
        resolvedVariantRevision && resolvedVariantRevision.length
            ? resolvedVariantRevision.startsWith("v")
                ? resolvedVariantRevision
                : `v${resolvedVariantRevision}`
            : null

    if (!revisionBadge) return null

    return (
        <div className="flex min-w-0 items-center gap-2 text-[11px] font-normal text-[rgba(5,23,41,0.45)]">
            <span className="rounded-full bg-[#F2F4F7] px-1.5 py-0.5 text-[10px] font-semibold text-[#344054]">
                {revisionBadge}
            </span>
        </div>
    )
}

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
            }),
        [columnResult?.columns, columnResult?.groups],
    )
    const outputGroupMap = useMemo(
        () => new Map((columnResult?.groups ?? []).map((group) => [group.id, group])),
        [columnResult?.groups],
    )

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
        ({initialPath, onPathChange}: TestcaseDrawerContentRenderProps): ReactNode => (
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
                        rootViewMode: true,
                        columnMapping: false,
                    }}
                />
            </div>
        ),
        [editorColumns, inputValue],
    )

    const renderOutputs = useCallback((): ReactNode => {
        if (!outputSections.length) return null

        return (
            <InvocationOutputsAdapter
                runId={runId ?? ""}
                scenarioId={scenarioId ?? ""}
                sections={outputSections}
                renderHeaderSlot={(section) => (
                    <InvocationMetaHeader
                        group={outputGroupMap.get(section.id) ?? null}
                        runId={runId}
                    />
                )}
            />
        )
    }, [outputGroupMap, outputSections, runId, scenarioId])

    const renderEvaluatorMetrics = useCallback(
        (): ReactNode => (
            <EvaluatorMetricsAdapter
                runId={runId ?? ""}
                scenarioId={scenarioId ?? ""}
                sections={metricSections}
            />
        ),
        [metricSections, runId, scenarioId],
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
            testcaseData={inputValue}
            isLoading={isLoading}
            isError={Boolean(error)}
            errorMessage={
                error instanceof Error ? error.message : error ? String(error) : undefined
            }
            isDirty={false}
            renderContent={renderContent}
            renderOutputs={renderOutputs}
            renderEvaluatorMetrics={renderEvaluatorMetrics}
        />
    )
}

export default EvalTestcaseDrawerAdapter
