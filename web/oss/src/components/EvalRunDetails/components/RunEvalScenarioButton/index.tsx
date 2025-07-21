import {memo, useMemo, useCallback} from "react"

import {Tooltip} from "antd"
import {useAtomValue} from "jotai"
import {loadable} from "jotai/utils"

import {useEvalScenarioQueue} from "@/oss/lib/hooks/useEvalScenarioQueue"
import {
    scenarioStatusAtomFamily,
    scenarioStepFamily,
} from "@/oss/lib/hooks/useEvaluationRunData/assets/atoms"

import RunButton from "../../../Playground/assets/RunButton"

import {RunEvalScenarioButtonProps} from "./types"

const RunEvalScenarioButton = memo(
    ({scenarioId, stepKey, label = "Run Scenario"}: RunEvalScenarioButtonProps) => {
        const {enqueueScenario} = useEvalScenarioQueue({concurrency: 5})

        // derive running flag directly from per-scenario status atom
        const scenarioStatus = useAtomValue(
            useMemo(() => scenarioStatusAtomFamily(scenarioId), [scenarioId]),
        ) as any
        const isRunning = scenarioStatus?.status === "running"

        // Derive invocationParameters via scenario step loadable
        const stepLoadable = useAtomValue(loadable(scenarioStepFamily(scenarioId)))

        // Extract invocation steps (if any)
        const invocationSteps =
            stepLoadable.state === "hasData" ? stepLoadable.data?.invocationSteps || [] : []

        // Determine target step
        const targetStep = stepKey
            ? invocationSteps.find((s) => s.key === stepKey)
            : invocationSteps.find((s) => s.invocationParameters)

        const autoStepKey = targetStep?.key
        const invocationParameters = targetStep?.invocationParameters
        const invocationStepStatus = targetStep?.status

        const handleClick = useCallback(() => {
            if (invocationParameters) {
                enqueueScenario(scenarioId, autoStepKey)
            }
        }, [enqueueScenario, scenarioId, autoStepKey, invocationParameters])

        const button = useMemo(
            () => (
                <RunButton
                    onClick={handleClick}
                    disabled={
                        isRunning || invocationStepStatus === "success" || !invocationParameters
                    }
                    loading={isRunning}
                    type="default"
                    label={label}
                />
            ),
            [handleClick, isRunning, invocationStepStatus, invocationParameters, label],
        )

        return (
            <div className="flex items-center gap-2 mx-2">
                {invocationParameters ? (
                    <Tooltip
                        className="pre-wrap"
                        title={
                            <div className="whitespace-pre">
                                {JSON.stringify(invocationParameters, null, 2)}
                            </div>
                        }
                    >
                        {button}
                    </Tooltip>
                ) : (
                    button
                )}
            </div>
        )
    },
)

export default RunEvalScenarioButton
