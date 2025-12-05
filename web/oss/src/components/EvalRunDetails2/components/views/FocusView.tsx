import {memo} from "react"

import SingleScenarioViewerPOC from "./SingleScenarioViewerPOC"

interface FocusViewProps {
    runId: string
}

const FocusView = ({runId}: FocusViewProps) => <SingleScenarioViewerPOC runId={runId} />

export default memo(FocusView)
