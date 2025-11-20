import {memo} from "react"

import {Progress} from "antd"
import {useAtomValue} from "jotai"

import {scenarioStepProgressAtom} from "@/oss/lib/hooks/useEvaluationRunData/assets/atoms"

import {conicColors} from "./assets/constants"

const ScenarioLoadingIndicator = () => {
    const scenarioStepProgress = useAtomValue(scenarioStepProgressAtom)

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
