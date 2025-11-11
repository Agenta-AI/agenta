import {RefObject, useEffect, useMemo} from "react"
import dynamic from "next/dynamic"

import {DownOutlined} from "@ant-design/icons"
import clsx from "clsx"
import {atom, useAtom, useAtomValue} from "jotai"
import {useResizeObserver} from "usehooks-ts"

import {useRunId} from "@/oss/contexts/RunIdContext"

import {EVAL_BG_COLOR} from "../../AutoEvalRun/assets/utils"
import {EvalRunTestCaseTableSkeleton} from "../../AutoEvalRun/components/EvalRunTestCaseViewer/assets/EvalRunTestCaseViewerSkeleton"
import {urlStateAtom} from "../../state/urlState"

import useExpandableComparisonDataSource from "./hooks/useExpandableComparisonDataSource"
import useScrollToScenario from "./hooks/useScrollToScenario"

const EnhancedTable = dynamic(() => import("@/oss/components/EnhancedUIs/Table"), {
    ssr: false,
    loading: () => <EvalRunTestCaseTableSkeleton />,
})

export const expendedRowAtom = atom<Record<string, boolean>>({})

const ComparisonTable = () => {
    const baseRunId = useRunId()
    const urlState = useAtomValue(urlStateAtom)
    const [expendedRows, setExpendedRows] = useAtom(expendedRowAtom)
    const comparisonRunIds = urlState.compare || []

    // Use the new expandable comparison data source
    const {
        antColumns: columns,
        rows: dataSource,
        loading,
    } = useExpandableComparisonDataSource({
        baseRunId,
        comparisonRunIds,
    })

    const expandedRowKeys = useMemo(
        () => Object.keys(expendedRows).filter((key) => expendedRows[key]),
        [expendedRows],
    )

    useEffect(() => {
        if (!dataSource?.length) return

        setExpendedRows((prev) => {
            const next = {...prev}
            let changed = false
            const availableKeys = new Set<string>()

            dataSource.forEach((row: any) => {
                if (!row?.key) return
                availableKeys.add(row.key)

                if (row.children?.length && prev[row.key] === undefined) {
                    next[row.key] = true
                    changed = true
                }
            })

            Object.keys(next).forEach((key) => {
                if (!availableKeys.has(key)) {
                    delete next[key]
                    changed = true
                }
            })

            return changed ? next : prev
        })
    }, [dataSource])

    const {tableContainerRef, tableInstance} = useScrollToScenario({
        dataSource,
        expandedRowKeys,
    })

    const {height: scrollY} = useResizeObserver({
        ref: tableContainerRef as RefObject<HTMLElement>,
        box: "border-box",
    })

    if (!baseRunId || !comparisonRunIds.length) {
        return (
            <div className="p-4">
                <div className="text-center text-gray-500">Please select runs to compare</div>
            </div>
        )
    }

    if (loading) {
        return <EvalRunTestCaseTableSkeleton />
    }

    return (
        <div className="h-full flex flex-col min-h-0">
            <div ref={tableContainerRef} className="flex-1 overflow-hidden min-h-0">
                <EnhancedTable
                    ref={tableInstance}
                    uniqueKey="scenario-table"
                    columns={columns}
                    dataSource={dataSource}
                    scroll={{x: "max-content", y: scrollY - 45}}
                    size="small"
                    virtualized
                    rowKey={(record: any) => record.key || record.scenarioId}
                    className="comparison-table agenta-scenario-table"
                    addNotAvailableCell={false}
                    skeletonRowCount={0}
                    loading={false}
                    tableLayout="fixed"
                    onRow={(record) => ({
                        style: record?.compareIndex
                            ? {background: EVAL_BG_COLOR[record.compareIndex]}
                            : undefined,
                        onClick: (event) => {
                            const target = event.target as HTMLElement
                            const isFirstCell = target.closest(".scenario-index-row-cell")

                            if (isFirstCell && record.children?.length > 0) {
                                const isExpanded = expendedRows[record.key]
                                if (isExpanded) {
                                    setExpendedRows((prev) => ({
                                        ...prev,
                                        [record.key]: false,
                                    }))
                                } else {
                                    setExpendedRows((prev) => ({
                                        ...prev,
                                        [record.key]: true,
                                    }))
                                }
                            }
                        },
                    })}
                    expandable={{
                        expandedRowKeys,
                        rowExpandable: (record: any) => record.children?.length > 0,
                        expandRowByClick: false,
                        expandedRowOffset: 1,
                        showExpandColumn: true, // Hide default expand column since we have custom one
                        indentSize: 0,
                        expandIcon: ({expanded, record, ...rest}) => {
                            if (!columns.find((col) => col.key === "#")?.key) return null
                            const showIndex = !record.isComparison
                            return (
                                <div className="w-full h-full flex items-start gap-2 cursor-pointer bg-[#fafafa] p-2 scenario-index-row-cell">
                                    {showIndex && <span>{record.scenarioIndex}</span>}
                                    {record.children?.length > 0 ? (
                                        <div className="w-5 h-5 rounded-sm bg-white flex items-center justify-center">
                                            <DownOutlined
                                                className={clsx(
                                                    "inline-block transition-transform duration-300",
                                                    {
                                                        "-rotate-90": !expanded,
                                                    },
                                                )}
                                            />
                                        </div>
                                    ) : null}
                                </div>
                            )
                        },
                    }}
                />
            </div>
        </div>
    )
}

export default ComparisonTable
