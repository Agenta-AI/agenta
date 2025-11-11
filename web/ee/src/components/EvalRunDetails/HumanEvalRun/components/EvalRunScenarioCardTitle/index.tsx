import {memo} from "react"

import {Typography} from "antd"

import EvalRunScenarioStatusTag from "../../../components/EvalRunScenarioStatusTag"

import {EvalRunScenarioCardTitleProps} from "./types"

const EvalRunScenarioCardTitle = ({
    scenarioIndex,
    scenarioId,
    runId,
}: EvalRunScenarioCardTitleProps) => {
    return (
        <div className="flex items-center justify-between">
            <Typography.Text className="!text-base">Test Case #{scenarioIndex}</Typography.Text>
            <EvalRunScenarioStatusTag scenarioId={scenarioId} runId={runId} />
        </div>
    )
}

export default memo(EvalRunScenarioCardTitle)
