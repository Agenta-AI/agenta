import {memo} from "react"

import {RunIdProvider} from "@/oss/contexts/RunIdContext"

import SingleScenarioViewerPOC from "./SingleScenarioViewerPOC"

interface FocusViewProps {
    runId: string
}

const FocusView = ({runId}: FocusViewProps) => (
    <RunIdProvider runId={runId}>
        <div className="flex h-full min-h-0">
            <SingleScenarioViewerPOC runId={runId} />
        </div>
    </RunIdProvider>
)

export default memo(FocusView)
