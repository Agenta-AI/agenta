import {memo} from "react"

import {useAtomValue} from "jotai"
import dynamic from "next/dynamic"

import {runViewTypeAtom} from "@/oss/lib/hooks/useEvaluationRunData/assets/atoms"

import {EvalRunProps} from "./assets/types"
import EvalRunBatchActions from "./components/EvalRunBatchActions"
import EvalRunName from "./components/EvalRunName"
import EvalRunScenarioCards from "./components/EvalRunScenarioCards/EvalRunScenarioCards"
import EvalRunScenarioFilters from "./components/EvalRunScenarioFilters"
import EvalRunScenariosViewSelector from "./components/EvalRunScenariosViewSelector"
import SingleScenarioViewer from "./components/SingleScenarioViewer"
import VirtualizedScenarioTable from "./components/VirtualizedScenarioTable"
import UrlSync from "./UrlSync"

const EvalResultsView = dynamic(() => import("./components/EvalResultsView"), {ssr: false})

const EvalRunDetails = ({name, description, id}: EvalRunProps) => {
    const viewType = useAtomValue(runViewTypeAtom)
    return (
        <div className="flex flex-col grow gap-6 pb-4 min-h-0">
            <UrlSync />
            <section className="w-full flex items-start justify-between gap-4">
                <div className="flex flex-col gap-4 shrink self-center">
                    <EvalRunName id={id} name={name} description={description} />
                    <EvalRunBatchActions name={name} />
                </div>
            </section>

            <section className="w-full flex items-center justify-between flex-wrap gap-4 mb-4">
                <EvalRunScenarioFilters />
                <EvalRunScenariosViewSelector />
            </section>

            <div className="grow flex flex-col gap-4 min-h-0">
                {viewType === "focus" ? (
                    <SingleScenarioViewer runId={id} />
                ) : viewType === "table" ? (
                    <VirtualizedScenarioTable />
                ) : viewType === "results" ? (
                    <EvalResultsView runId={id} />
                ) : (
                    <EvalRunScenarioCards runId={id} />
                )}
            </div>
        </div>
    )
}

export default memo(EvalRunDetails)
