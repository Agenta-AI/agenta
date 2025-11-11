import {memo} from "react"

import VirtualizedScenarioTable from "@/oss/components/EvalRunDetails/components/VirtualizedScenarioTable"
import useTableDataSource from "@/oss/components/EvalRunDetails/components/VirtualizedScenarioTable/hooks/useTableDataSource"

import EvalRunTestCaseViewUtilityOptions from "../EvalRunTestCaseViewUtilityOptions"

import EvalRunTestCaseViewerSkeleton from "./assets/EvalRunTestCaseViewerSkeleton"

const EvalRunTestCaseViewer = () => {
    const {antColumns, isLoadingSteps, setEditColumns, rawColumns} = useTableDataSource()

    if (isLoadingSteps) {
        return <EvalRunTestCaseViewerSkeleton />
    }

    return (
        <div className="flex flex-col grow gap-1 min-h-0">
            <EvalRunTestCaseViewUtilityOptions
                setEditColumns={setEditColumns}
                columns={rawColumns}
            />

            <div className="grow flex flex-col gap-4 min-h-0 px-6">
                <VirtualizedScenarioTable />
            </div>
        </div>
    )
}

export default memo(EvalRunTestCaseViewer)
