import {memo, RefObject, useRef, useEffect} from "react"

import {Table} from "antd"
import {useAtomValue} from "jotai"
import dynamic from "next/dynamic"
import {useResizeObserver} from "usehooks-ts"

import {evaluationRunIdAtom} from "@/oss/lib/hooks/useEvaluationRunData/assets/atoms"

/* SKELETON_ROW_COUNT reserved for future dynamic skeleton sizing */
import useTableDataSource from "./hooks/useTableDataSource"
import {VirtualizedScenarioTableProps} from "./types"
import {useRouter} from "next/router"

import {ResizableTitle} from "@/oss/components/EnhancedUIs/Table/assets/CustomCells"

const VirtualizedScenarioTableAnnotateDrawer = dynamic(
    () => import("./assets/VirtualizedScenarioTableAnnotateDrawer"),
    {ssr: false},
)

const VirtualizedScenarioTable = ({
    columns,
    dataSource,
    totalColumnWidth,
}: VirtualizedScenarioTableProps) => {
    // Data sources
    const runId = useAtomValue(evaluationRunIdAtom)
    const tableContainerRef = useRef<HTMLDivElement | null>(null)
    const tableInstance = useRef<any>(null)
    const router = useRouter()

    const selectedScenarioId = router.query.scrollTo as string

    // Measure container height only; horizontal scroll is derived from column widths
    const {height: scrollY} = useResizeObserver({
        ref: tableContainerRef as RefObject<HTMLElement>,
        box: "border-box",
    })

    const {antColumns, rows, totalColumnWidth: _totalColumnWidth} = useTableDataSource()

    // Scroll to the specified row when user selects a scenario in auto eval
    useEffect(() => {
        if (selectedScenarioId && tableInstance.current) {
            // Get the row index from the dataSource
            const _dataSource = dataSource?.length ? dataSource : rows
            const rowIndex = _dataSource.findIndex((row) => row.key === selectedScenarioId)

            if (rowIndex !== -1) {
                // Use Ant Design's scrollTo method for virtualized tables
                tableInstance.current.scrollTo({
                    index: rowIndex,
                    behavior: "smooth",
                })

                // Add highlight effect
                const rowElement = tableContainerRef.current?.querySelector(
                    `[data-row-key="${selectedScenarioId}"]`,
                )
                if (rowElement) {
                    rowElement.classList.add("highlight-row")
                    setTimeout(() => {
                        rowElement.classList.remove("highlight-row")
                    }, 2000)
                }
            }
        }
    }, [selectedScenarioId, dataSource, rows])

    return (
        <div className="grow flex flex-col w-full min-h-0">
            <div className="relative grow flex flex-col min-h-0">
                <div ref={tableContainerRef} className="relative w-full flex-1 min-h-0">
                    {scrollY ? (
                        <Table
                            className="agenta-scenario-table"
                            dataSource={dataSource?.length ? dataSource : rows}
                            rowClassName="scenario-row"
                            columns={columns?.length ? columns : antColumns}
                            rowKey={(record) => record.key}
                            components={{
                                header: {
                                    cell: ResizableTitle,
                                },
                            }}
                            pagination={false}
                            scroll={{
                                y:
                                    scrollY -
                                    ((
                                        tableContainerRef.current?.querySelector(
                                            ".ant-table-thead",
                                        ) as HTMLElement
                                    )?.offsetHeight || 0),
                                x: totalColumnWidth || _totalColumnWidth,
                            }}
                            size="small"
                            sticky
                            virtual
                            bordered
                            tableLayout="fixed"
                            ref={tableInstance}
                        />
                    ) : null}

                    <VirtualizedScenarioTableAnnotateDrawer runId={runId} />
                </div>
            </div>
        </div>
    )
}

export default memo(VirtualizedScenarioTable)
