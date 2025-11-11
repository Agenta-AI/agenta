import {memo} from "react"

import InvocationInputs from "./InvocationInputs"
import InvocationResponse from "./InvocationResponse"
import {InvocationRunProps} from "./types"

const InvocationRun = ({invStep, scenarioId, runId}: InvocationRunProps) => {
    return (
        <div className="flex flex-col gap-6 w-full text-sm">
            <InvocationInputs
                scenarioId={scenarioId}
                testcaseId={invStep.testcaseId}
                runId={runId}
            />
            <InvocationResponse scenarioId={scenarioId} stepKey={invStep.stepKey} runId={runId} />
        </div>
    )
}

export default memo(InvocationRun)
