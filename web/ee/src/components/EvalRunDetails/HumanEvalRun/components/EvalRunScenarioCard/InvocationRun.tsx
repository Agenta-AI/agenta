import {memo} from "react"

import InvocationInputs from "./InvocationInputs"
import InvocationResponse from "./InvocationResponse"
import {InvocationRunProps} from "./types"

const InvocationRun = ({invStep, scenarioId}: InvocationRunProps) => {
    return (
        <div className="flex flex-col gap-6 w-full text-sm">
            <InvocationInputs scenarioId={scenarioId} testcaseId={invStep.testcaseId} />
            <InvocationResponse scenarioId={scenarioId} stepKey={invStep.key} />
        </div>
    )
}

export default memo(InvocationRun)
