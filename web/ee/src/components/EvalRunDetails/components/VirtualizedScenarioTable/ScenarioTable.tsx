import {memo} from "react"

import dynamic from "next/dynamic"
import {useResizeObserver} from "usehooks-ts"

import {useRunId} from "@/oss/contexts/RunIdContext"

import {EvalRunTestCaseTableSkeleton} from "../../AutoEvalRun/components/EvalRunTestCaseViewer/assets/EvalRunTestCaseViewerSkeleton"

import useScrollToScenario from "./hooks/useScrollToScenario"
import useTableDataSource from "./hooks/useTableDataSource"

const EnhancedTable = dynamic(() => import("@/oss/components/EnhancedUIs/Table"), {
    ssr: false,
    loading: () => <EvalRunTestCaseTableSkeleton />,
})
const VirtualizedScenarioTableAnnotateDrawer = dynamic(
    () => import("./assets/VirtualizedScenarioTableAnnotateDrawer"),
    {ssr: false},
)

const ScenarioTable = ({runId: propRunId}: {runId?: string}) => {
    // Data sources - use prop runId if provided, otherwise fall back to context
    const contextRunId = useRunId()
    const runId = propRunId || contextRunId
    const {antColumns, rows, isLoadingSteps} = useTableDataSource()

    const {tableContainerRef, tableInstance} = useScrollToScenario({
        dataSource: rows,
    })

    const {height: scrollY} = useResizeObserver({
        ref: tableContainerRef,
        box: "border-box",
    })

    return (
        <div ref={tableContainerRef} className="grow flex flex-col w-full min-h-0">
            {isLoadingSteps ? (
                <EvalRunTestCaseTableSkeleton />
            ) : (
                <div className="relative w-full flex-1 min-h-0">
                    {!scrollY ? null : (
                        <EnhancedTable
                            uniqueKey="scenario-table"
                            columns={antColumns as any}
                            dataSource={rows}
                            scroll={{x: "max-content", y: scrollY - 45}}
                            size="small"
                            virtualized
                            rowKey={(record: any) => record.key || record.scenarioId}
                            className="agenta-scenario-table"
                            rowClassName="scenario-row"
                            tableLayout="fixed"
                            skeletonRowCount={0}
                            loading={false}
                            ref={tableInstance}
                        />
                    )}

                    <VirtualizedScenarioTableAnnotateDrawer runId={runId} />
                </div>
            )}
        </div>
    )
}

export default memo(ScenarioTable)
