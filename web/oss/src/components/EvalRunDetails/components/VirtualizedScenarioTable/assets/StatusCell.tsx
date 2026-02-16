import {memo} from "react"

import {useRunId} from "@/oss/contexts/RunIdContext"

import EvalRunScenarioStatusTag from "../../EvalRunScenarioStatusTag"

import {CellWrapper} from "./CellComponents"

interface Props {
    scenarioId: string
    result?: string
    runId?: string
}

/**
 * Lightweight status cell for Scenario rows.
 * Displays coloured status tag and optional result snippet.
 */
const StatusCell = ({scenarioId, runId: propRunId}: Props) => {
    const contextRunId = useRunId()
    const effectiveRunId = propRunId || contextRunId

    return (
        <CellWrapper className="gap-2">
            <EvalRunScenarioStatusTag scenarioId={scenarioId} runId={effectiveRunId} />
        </CellWrapper>
    )
}

export default memo(StatusCell)
