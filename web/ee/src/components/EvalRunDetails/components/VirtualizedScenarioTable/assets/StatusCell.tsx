import {memo} from "react"

import EvalRunScenarioStatusTag from "../../EvalRunScenarioStatusTag"

import {CellWrapper} from "./CellComponents"

interface Props {
    scenarioId: string
    result?: string
}

/**
 * Lightweight status cell for Scenario rows.
 * Displays coloured status tag and optional result snippet.
 */
const StatusCell = ({scenarioId}: Props) => {
    return (
        <CellWrapper className="gap-2">
            <EvalRunScenarioStatusTag scenarioId={scenarioId} />
        </CellWrapper>
    )
}

export default memo(StatusCell)
