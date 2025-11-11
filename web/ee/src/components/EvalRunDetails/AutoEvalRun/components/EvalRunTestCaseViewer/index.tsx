import {memo, useMemo, useState} from "react"
import EvalRunTestCaseViewUtilityOptions from "../EvalRunTestCaseViewUtilityOptions"
import useTableDataSource from "@/oss/components/EvalRunDetails/components/VirtualizedScenarioTable/hooks/useTableDataSource"
import VirtualizedScenarioTable from "@/oss/components/EvalRunDetails/components/VirtualizedScenarioTable"
import {filterColumns} from "@/oss/components/Filters/EditColumns/assets/helper"
import EvalRunFocusDrawer from "../EvalRunFocusDrawer"
import EvalRunTestCaseViewerSkeleton from "./assets/EvalRunTestCaseViewerSkeleton"

const EvalRunTestCaseViewer = () => {
    const {antColumns, rows, totalColumnWidth, isLoadingSteps} = useTableDataSource()
    const [editColumns, setEditColumns] = useState<string[]>([])

    const visibleColumns = useMemo(
        () => filterColumns(antColumns, editColumns),
        [antColumns, editColumns],
    )

    if (isLoadingSteps) {
        return <EvalRunTestCaseViewerSkeleton />
    }

    return (
        <div className="flex flex-col grow gap-1 pb-4 min-h-0">
            <EvalRunTestCaseViewUtilityOptions
                setEditColumns={setEditColumns}
                columns={antColumns}
            />

            <div className="grow flex flex-col gap-4 min-h-0 px-6">
                <VirtualizedScenarioTable
                    columns={visibleColumns}
                    dataSource={rows}
                    totalColumnWidth={totalColumnWidth}
                />
            </div>

            <EvalRunFocusDrawer />
        </div>
    )
}

export default memo(EvalRunTestCaseViewer)
