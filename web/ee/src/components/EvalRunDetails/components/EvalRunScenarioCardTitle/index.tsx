import {memo} from "react"

import {Typography} from "antd"

import EvalRunScenarioStatusTag from "../EvalRunScenarioStatusTag"

import {EvalRunScenarioCardTitleProps} from "./types"

const EvalRunScenarioCardTitle = ({scenarioIndex, scenarioId}: EvalRunScenarioCardTitleProps) => {
    return (
        <div className="flex items-center justify-between">
            <Typography.Text className="!text-base">Test Case #{scenarioIndex}</Typography.Text>
            <EvalRunScenarioStatusTag scenarioId={scenarioId} />
        </div>
    )
}

export default memo(EvalRunScenarioCardTitle)
