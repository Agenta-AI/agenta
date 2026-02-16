import {memo} from "react"

import {Progress} from "antd"
import {useAtomValue} from "jotai"

import {scenarioStepProgressFamily} from "@/oss/lib/hooks/useEvaluationRunData/assets/atoms"

import {conicColors} from "./assets/constants"

const ScenarioLoadingIndicator = ({runId}: {runId: string}) => {
    const scenarioStepProgress = useAtomValue(scenarioStepProgressFamily(runId))

    return scenarioStepProgress.loadingStep === "scenario-steps" ? (
        <Progress
            className="[&_.ant-progress-text]:hidden"
            percent={scenarioStepProgress.percent ?? undefined}
            size="small"
            strokeColor={conicColors}
        />
    ) : null
}

export default memo(ScenarioLoadingIndicator)
