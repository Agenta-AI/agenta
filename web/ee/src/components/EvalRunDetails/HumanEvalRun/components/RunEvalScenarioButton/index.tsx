import {memo, useMemo, useCallback} from "react"

import RunButton from "@agenta/oss/src/components/Playground/assets/RunButton"
import {Tooltip} from "antd"
import {useAtomValue} from "jotai"
import {loadable} from "jotai/utils"

// Use EE run-scoped versions for multi-run support
import {useEvalScenarioQueue} from "@/oss/lib/hooks/useEvalScenarioQueue"
import {
    getCurrentRunId,
    scenarioStepFamily,
} from "@/oss/lib/hooks/useEvaluationRunData/assets/atoms"

import {RunEvalScenarioButtonProps} from "./types"

const RunEvalScenarioButton = memo(
    ({scenarioId, stepKey, label = "Run Scenario", runId}: RunEvalScenarioButtonProps) => {
        // Use effective runId with fallback using useMemo
        const effectiveRunId = useMemo(() => {
            if (runId) return runId
            try {
                return getCurrentRunId()
            } catch (error) {
                console.warn("[RunEvalScenarioButton] No run ID available:", error)
                return ""
            }
        }, [runId])

        const {enqueueScenario} = useEvalScenarioQueue({concurrency: 5, runId: effectiveRunId})

        // Derive invocationParameters via scenario step loadable (run-scoped) - use global store
        const stepLoadable = useAtomValue(
            loadable(scenarioStepFamily({scenarioId, runId: effectiveRunId})),
        )

        // derive running flag directly from run-scoped scenario step data
        const isRunning = useMemo(() => {
            if (stepLoadable.state !== "hasData" || !stepLoadable.data) return false
            const data = stepLoadable.data
            return (
                data?.invocationSteps?.some((s: any) => s.status === "running") ||
                data?.annotationSteps?.some((s: any) => s.status === "running") ||
                data?.inputSteps?.some((s: any) => s.status === "running")
            )
        }, [stepLoadable])

        // Extract invocation steps (if any)
        const invocationSteps =
            stepLoadable.state === "hasData" ? stepLoadable.data?.invocationSteps || [] : []

        // Determine target step
        const targetStep = stepKey
            ? invocationSteps.find((s) => s.stepKey === stepKey)
            : invocationSteps.find((s) => s.invocationParameters)

        const autoStepKey = targetStep?.stepKey
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
