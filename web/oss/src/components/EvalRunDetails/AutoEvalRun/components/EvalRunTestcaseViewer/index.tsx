import {memo} from "react"

import VirtualizedScenarioTable from "@/oss/components/EvalRunDetails/components/VirtualizedScenarioTable"
import useTableDataSource from "@/oss/components/EvalRunDetails/components/VirtualizedScenarioTable/hooks/useTableDataSource"

import EvalRunTestcaseViewUtilityOptions from "../EvalRunTestcaseViewUtilityOptions"

import EvalRunTestcaseViewerSkeleton from "./assets/EvalRunTestcaseViewerSkeleton"

const EvalRunTestcaseViewer = () => {
    const {antColumns, isLoadingSteps, setEditColumns, rawColumns} = useTableDataSource()

    if (isLoadingSteps) {
        return <EvalRunTestcaseViewerSkeleton />
    }

    return (
        <div className="flex flex-col grow gap-1 min-h-0">
            <EvalRunTestcaseViewUtilityOptions
                setEditColumns={setEditColumns}
                columns={rawColumns}
            />

            <div className="grow flex flex-col gap-4 min-h-0 px-6">
                <VirtualizedScenarioTable />
            </div>
        </div>
    )
}

export default memo(EvalRunTestcaseViewer)
