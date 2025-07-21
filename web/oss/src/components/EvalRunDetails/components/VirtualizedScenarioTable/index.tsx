import {memo, RefObject, useRef} from "react"

import {Table} from "antd"
import {useAtomValue} from "jotai"
import dynamic from "next/dynamic"
import {useResizeObserver} from "usehooks-ts"

import "react-resizable/css/styles.css"
import "@/oss/assets/custom-resize-handle.css"

import {evaluationRunIdAtom} from "@/oss/lib/hooks/useEvaluationRunData/assets/atoms"

import ResizableTitle from "../../../ResizableTitle"

/* SKELETON_ROW_COUNT reserved for future dynamic skeleton sizing */
import useTableDataSource from "./hooks/useTableDataSource"

const VirtualizedScenarioTableAnnotateDrawer = dynamic(
    () => import("./assets/VirtualizedScenarioTableAnnotateDrawer"),
    {ssr: false},
)

const VirtualizedScenarioTable = () => {
    // Data sources
    const runId = useAtomValue(evaluationRunIdAtom)
    const tableContainerRef = useRef<HTMLDivElement | null>(null)

    // Measure container height only; horizontal scroll is derived from column widths
    const {height: scrollY} = useResizeObserver({
        ref: tableContainerRef as RefObject<HTMLElement>,
        box: "border-box",
    })

    const {antColumns, rows, totalColumnWidth} = useTableDataSource()

    return (
        <div className="grow flex flex-col w-full min-h-0">
            <div className="relative grow flex flex-col min-h-0">
                <div ref={tableContainerRef} className="relative w-full flex-1 min-h-0">
                    {scrollY ? (
                        <Table
                            className="agenta-scenario-table"
                            dataSource={rows}
                            rowClassName="scenario-row"
                            columns={antColumns}
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
                                    (tableContainerRef.current?.querySelector(".ant-table-thead")
                                        ?.offsetHeight || 0),
                                x: totalColumnWidth,
                            }}
                            size="small"
                            sticky
                            virtual
                            bordered
                            tableLayout="fixed"
                        />
                    ) : null}

                    <VirtualizedScenarioTableAnnotateDrawer runId={runId} />
                </div>
            </div>
        </div>
    )
}

export default memo(VirtualizedScenarioTable)
