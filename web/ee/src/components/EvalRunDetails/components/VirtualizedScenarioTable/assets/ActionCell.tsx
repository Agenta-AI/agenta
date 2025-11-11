import {memo, useCallback} from "react"

import {Button, Spin} from "antd"
import {useAtomValue} from "jotai"
import {loadable} from "jotai/utils"

import {virtualScenarioTableAnnotateDrawerAtom} from "@/oss/lib/atoms/virtualTable"
import {evalAtomStore} from "@/oss/lib/hooks/useEvaluationRunData/assets/atoms"
import {scenarioStepFamily} from "@/oss/lib/hooks/useEvaluationRunData/assets/atoms/scenarios"

import RunEvalScenarioButton from "../../../HumanEvalRun/components/RunEvalScenarioButton"

import {CellWrapper} from "./CellComponents"

/**
 * Shared action-cell renderer for the Scenario tables (OSS & EE).
 * Shows either a "Run" button (if scenario hasn't been executed) or an "Annotate" action.
 */
const ActionCell = ({scenarioId}: {scenarioId: string}) => {
    const stepLoadable = useAtomValue(loadable(scenarioStepFamily(scenarioId)))

    const openAnnotateDrawer = useCallback(() => {
        const store = evalAtomStore()
        store.set(virtualScenarioTableAnnotateDrawerAtom, {
            open: true,
            scenarioId,
        } as any)
    }, [scenarioId])

    if (stepLoadable.state !== "hasData") {
        return (
            <CellWrapper className="justify-center">
                <Spin size="small" />
            </CellWrapper>
        )
    }

    const data = stepLoadable.data

    const invocationArr: any[] = data?.invocationSteps || []

    const allSuccess =
        invocationArr.length > 0 && invocationArr.every((s) => s.status === "success")

    // first step that still has parameters to run
    const firstStepKey = invocationArr.find((s: any) => s.invocationParameters)?.key

    if (!allSuccess) {
        return (
            <CellWrapper className="justify-center">
                <RunEvalScenarioButton scenarioId={scenarioId} stepKey={firstStepKey} label="Run" />
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
