import {memo, useMemo} from "react"

import {Card} from "antd"
import deepEqual from "fast-deep-equal"
import {useAtomValue} from "jotai"
import {selectAtom} from "jotai/utils"

import {
    evaluationRunStateFamily,
    evalAtomStore,
} from "@/oss/lib/hooks/useEvaluationRunData/assets/atoms"
import {EvaluationRunState} from "@/oss/lib/hooks/useEvaluationRunData/types"

import EvalRunScenarioCardTitle from "../EvalRunScenarioCardTitle"
import RunEvalScenarioButton from "../RunEvalScenarioButton"

import EvalRunScenarioCardBody from "./EvalRunScenarioCardBody"
import {EvalRunScenarioCardProps} from "./types"

/**
 * Component that renders a card view for a specific evaluation run scenario.
 * Depending on the `viewType`, it can display the scenario in a card format
 * or a full-width format. Utilizes data from Jotai atoms to display scenario
 * details, including loading state and error handling.
 *
 * @param {string} scenarioId - The unique identifier for the scenario to be displayed.
 * @param {ViewType} [viewType="list"] - Determines the layout of the scenario display,
 *                                       either as a "list" (card format) or "single" (full-width).
 */
const EvalRunScenarioCard = ({scenarioId, runId, viewType = "list"}: EvalRunScenarioCardProps) => {
    const store = evalAtomStore()

    /* scenario index for card title */
    // Read from the same global store that writes are going to
    const scenarioIndex = useAtomValue(
        useMemo(
            () =>
                selectAtom(
                    evaluationRunStateFamily(runId), // Use run-scoped atom with runId
                    (state: EvaluationRunState) =>
                        state.scenarios?.find((s) => s.id === scenarioId)?.scenarioIndex,
                    deepEqual,
                ),
            [scenarioId, runId], // Include runId in dependencies
        ),
        {store},
    )

    if (scenarioIndex === undefined) return null

    return viewType === "list" ? (
        <Card
            title={
                <EvalRunScenarioCardTitle
                    scenarioId={scenarioId}
                    runId={runId}
                    scenarioIndex={scenarioIndex}
                />
            }
            style={{width: 400}}
            className="self-stretch"
            actions={[<RunEvalScenarioButton scenarioId={scenarioId} key="run" />]}
        >
            <EvalRunScenarioCardBody scenarioId={scenarioId} runId={runId} />
        </Card>
    ) : (
        <div className="flex flex-col gap-4 w-full">
            <EvalRunScenarioCardBody scenarioId={scenarioId} runId={runId} />
        </div>
    )
}

export default memo(EvalRunScenarioCard)
