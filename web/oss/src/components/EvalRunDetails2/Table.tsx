import {useCallback, useMemo} from "react"

import type {ColumnsType} from "antd/es/table"
import clsx from "clsx"
import {useAtomValue, useSetAtom} from "jotai"

import {
    InfiniteVirtualTable,
    useInfiniteTablePagination,
} from "@/oss/components/InfiniteVirtualTable"

import {MAX_COMPARISON_RUNS, compareRunIdsAtom, getComparisonColor} from "./atoms/compare"
import {DEFAULT_SCENARIO_PAGE_SIZE} from "./atoms/table"
import type {PreviewTableRow} from "./atoms/tableRows"
import {evaluationPreviewTableStore} from "./evaluationPreviewTableStore"
import usePreviewColumns from "./hooks/usePreviewColumns"
import usePreviewTableData from "./hooks/usePreviewTableData"
import usePrimeScenarioHydration from "./hooks/usePrimeScenarioHydration"
import useResizablePreviewColumns from "./hooks/useResizablePreviewColumns"
import {openFocusDrawerAtom, setFocusDrawerTargetAtom} from "./state/focusDrawerAtom"
import {patchFocusDrawerQueryParams} from "./state/urlFocusDrawer"

type TableRowData = PreviewTableRow

interface EvalRunDetailsTableProps {
    runId: string
    evaluationType: "auto" | "human"
    skeletonRowCount?: number
    projectId?: string | null
}

const EvalRunDetailsTable = ({
    runId,
    evaluationType,
    skeletonRowCount = DEFAULT_SCENARIO_PAGE_SIZE,
    projectId = null,
}: EvalRunDetailsTableProps) => {
    const pageSize = skeletonRowCount ?? 50
    const compareRunIds = useAtomValue(compareRunIdsAtom)
    const setFocusDrawerTarget = useSetAtom(setFocusDrawerTargetAtom)
    const openFocusDrawer = useSetAtom(openFocusDrawerAtom)

    const {rows, loadNextPage} = useInfiniteTablePagination({
        store: evaluationPreviewTableStore,
        scopeId: runId,
        pageSize,
    })

    const compareSlots = useMemo(
        () => Array.from({length: MAX_COMPARISON_RUNS}, (_, index) => compareRunIds[index] ?? null),
        [compareRunIds],
    )

    const comparePaginations = compareSlots.map((slotRunId) =>
        useInfiniteTablePagination<PreviewTableRow>({
            store: evaluationPreviewTableStore,
            scopeId: slotRunId,
            pageSize,
        }),
    )

    const compareRowsBySlot = comparePaginations.map((pagination) => pagination.rows)

    const {columnResult} = usePreviewTableData({runId})

    const previewColumns = usePreviewColumns({columnResult, evaluationType})

    const {columns: resizableColumns, components} = useResizablePreviewColumns({
        baseColumns: previewColumns.columns,
    })

    const mergedRows = useMemo(() => {
        if (!compareSlots.some(Boolean)) {
            return rows.map((row) => ({
                ...row,
                baseScenarioId: row.scenarioId ?? row.id,
                compareIndex: 0,
                isComparisonRow: false,
            }))
        }

        const baseRows = rows.map((row) => ({
            ...row,
            baseScenarioId: row.scenarioId ?? row.id,
            compareIndex: 0,
            isComparisonRow: false,
        }))

        const compareData = compareSlots.map((runId, idx) => {
            const slotRows = compareRowsBySlot[idx] ?? []
            const mapByTestcase = new Map<string, PreviewTableRow>()
            const mapByIndex = new Map<number, PreviewTableRow>()

            slotRows.forEach((row) => {
                if (!row || row.__isSkeleton) return
                if (row.testcaseId) {
                    mapByTestcase.set(row.testcaseId, row)
                }
                if (typeof row.scenarioIndex === "number") {
                    mapByIndex.set(row.scenarioIndex, row)
                }
            })

            return {
                runId,
                rows: slotRows,
                mapByTestcase,
                mapByIndex,
                compareIndex: idx + 1,
            }
        })

        const result: PreviewTableRow[] = []

        baseRows.forEach((baseRow) => {
            result.push(baseRow)
            if (baseRow.__isSkeleton) {
                return
            }

            const baseTestcaseId = baseRow.testcaseId
            const baseScenarioIndex = baseRow.scenarioIndex
            const baseScenarioId = baseRow.scenarioId ?? baseRow.id

            compareData.forEach(({runId, mapByTestcase, mapByIndex, compareIndex}) => {
                if (!runId) return
                const counterpart =
                    (baseTestcaseId ? mapByTestcase.get(baseTestcaseId) : undefined) ||
                    mapByIndex.get(baseScenarioIndex)

                if (counterpart) {
                    const key = `${runId}:${counterpart.scenarioId ?? counterpart.id}`
                    result.push({
                        ...counterpart,
                        rowId: key,
                        key,
                        runId,
                        baseScenarioId,
                        scenarioIndex: baseRow.scenarioIndex,
                        compareIndex,
                        isComparisonRow: true,
                        testcaseId: counterpart.testcaseId ?? baseTestcaseId,
                    })
                } else {
                    const key = `${runId}:${baseScenarioId}:placeholder:${compareIndex}`
                    result.push({
                        ...baseRow,
                        rowId: key,
                        key,
                        runId,
                        scenarioId: undefined,
                        baseScenarioId,
                        compareIndex,
                        isComparisonRow: true,
                        testcaseId: baseTestcaseId,
                        status: "loading",
                        __isSkeleton: true,
                    })
                }
            })
        })

        return result
    }, [rows, compareSlots, compareRowsBySlot])

    usePrimeScenarioHydration(mergedRows)

    const handleRowClick = useCallback(
        (record: TableRowData) => {
            if (record.__isSkeleton) return
            const scenarioId = record.scenarioId ?? record.id
            if (!scenarioId) return
            const targetRunId = record.runId ?? runId
            if (!targetRunId) return

            const focusTarget = {focusRunId: targetRunId, focusScenarioId: scenarioId}
            if (process.env.NEXT_PUBLIC_EVAL_RUN_DEBUG === "true") {
                // eslint-disable-next-line no-console
                console.info("[EvalRunDetails2][Table] row click", {focusTarget, record})
            }

            setFocusDrawerTarget(focusTarget)
            openFocusDrawer(focusTarget)
            patchFocusDrawerQueryParams(focusTarget)
        },
        [openFocusDrawer, runId, setFocusDrawerTarget],
    )

    const handleLoadMore = useCallback(() => {
        loadNextPage()
        comparePaginations.forEach((pagination, idx) => {
            if (!compareSlots[idx]) return
            pagination.loadNextPage()
        })
    }, [loadNextPage, comparePaginations, compareSlots])

    return (
        <section className="bg-zinc-1 w-full h-full overflow-scroll flex flex-col px-4 pt-2">
            <div className="w-full grow min-h-0 overflow-scroll">
                <InfiniteVirtualTable<TableRowData>
                    columns={resizableColumns as ColumnsType<TableRowData>}
                    dataSource={mergedRows}
                    rowKey={(record) => record.key}
                    loadMore={handleLoadMore}
                    containerClassName="w-full h-full overflow-hidden"
                    tableClassName="agenta-scenario-table"
                    tableProps={{
                        components,
                        rowClassName: (record) =>
                            clsx("scenario-row", {
                                "scenario-row--comparison": record.isComparisonRow,
                            }),
                        size: "small",
                        sticky: true,
                        virtual: true,
                        bordered: true,
                        tableLayout: "fixed",
                        scroll: {x: "max-content"},
                        onRow: (record) => ({
                            onClick: (event) => {
                                const target = event.target as HTMLElement | null
                                if (target?.closest("[data-ivt-stop-row-click]")) return
                                handleRowClick(record as TableRowData)
                            },
                            className: clsx({
                                "comparison-row": record.isComparisonRow,
                            }),
                            style: record.compareIndex
                                ? {
                                      backgroundColor: getComparisonColor(record.compareIndex),
                                  }
                                : undefined,
                        }),
                    }}
                />
            </div>
        </section>
    )
}

export default EvalRunDetailsTable
