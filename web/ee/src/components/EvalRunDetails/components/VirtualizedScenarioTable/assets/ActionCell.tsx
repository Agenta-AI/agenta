import {memo, useCallback} from "react"

import {Button, Spin} from "antd"
import {getDefaultStore} from "jotai"

import {useRunId} from "@/oss/contexts/RunIdContext"
import {virtualScenarioTableAnnotateDrawerAtom} from "@/oss/lib/atoms/virtualTable"

// Use EE run-scoped versions for multi-run support
import {
    hasScenarioStepData,
    useScenarioStepSnapshot,
} from "../../../../../lib/hooks/useEvaluationRunData/useScenarioStepSnapshot"
import RunEvalScenarioButton from "../../../HumanEvalRun/components/RunEvalScenarioButton"

import {CellWrapper} from "./CellComponents"

/**
 * Shared action-cell renderer for the Scenario tables (OSS & EE).
 * Shows either a "Run" button (if scenario hasn't been executed) or an "Annotate" action.
 */
const ActionCell = ({scenarioId, runId: propRunId}: {scenarioId: string; runId?: string}) => {
    const store = getDefaultStore()
    const contextRunId = useRunId()
    const effectiveRunId = propRunId || contextRunId

    const {data: stepData} = useScenarioStepSnapshot(scenarioId, effectiveRunId)

    const openAnnotateDrawer = useCallback(() => {
        store.set(virtualScenarioTableAnnotateDrawerAtom, {
            open: true,
            scenarioId,
            runId: effectiveRunId, // Include runId for multi-run support
        })
    }, [scenarioId, effectiveRunId, store])

    if (!effectiveRunId || !hasScenarioStepData(stepData)) {
        return (
            <CellWrapper className="justify-center">
                <Spin size="small" />
            </CellWrapper>
        )
    }

    const invocationArr: any[] = stepData?.invocationSteps || []

    const allSuccess =
        invocationArr.length > 0 && invocationArr.every((s) => s.status === "success")

    // first step that still has parameters to run
    const firstStepKey = invocationArr.find((s: any) => s.invocationParameters)?.stepKey

    if (!allSuccess) {
        return (
            <CellWrapper className="justify-center">
                <RunEvalScenarioButton
                    scenarioId={scenarioId}
                    stepKey={firstStepKey}
                    label="Run"
                    runId={effectiveRunId}
                />
            </CellWrapper>
        )
    }

    return (
        <CellWrapper className="justify-center">
            <Button size="small" onClick={openAnnotateDrawer}>
                Annotate
            </Button>
        </CellWrapper>
    )
}

export default memo(ActionCell)
