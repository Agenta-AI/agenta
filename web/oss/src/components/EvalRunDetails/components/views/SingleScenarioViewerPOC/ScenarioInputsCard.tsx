import {memo} from "react"

import {Card} from "antd"

import ColumnValueView from "./ColumnValueView"
import StepContentRenderer from "./StepContentRenderer"
import type {ScenarioInputsCardProps} from "./types"
import {getStepKey} from "./utils"

const ScenarioInputsCard = ({
    columns,
    steps,
    scenarioId,
    runId,
    isLoading,
}: ScenarioInputsCardProps) => {
    if (isLoading) {
        return (
            <Card title="Inputs">
                <span className="text-muted-foreground">Loading inputs…</span>
            </Card>
        )
    }

    if (columns.length > 0) {
        return (
            <Card title="Inputs">
                <div className="flex flex-col gap-4">
                    {columns.map((column) => (
                        <div key={column.id} className="flex flex-col gap-2">
                            <span className="font-semibold">
                                {column.displayLabel ?? column.label}
                            </span>
                            <ColumnValueView
                                column={column}
                                scenarioId={scenarioId}
                                runId={runId}
                            />
                        </div>
                    ))}
                </div>
            </Card>
        )
    }

    if (steps.length > 0) {
        return (
            <Card title="Inputs">
                <div className="flex flex-col gap-4">
                    {steps.map((step) => (
                        <div key={step.id ?? getStepKey(step)} className="flex flex-col gap-2">
                            <span className="font-semibold">{getStepKey(step) || "Input"}</span>
                            <StepContentRenderer step={step} />
                        </div>
                    ))}
                </div>
            </Card>
        )
    }

    return (
        <Card title="Inputs">
            <span className="text-muted-foreground">No input data.</span>
        </Card>
    )
}

export default memo(ScenarioInputsCard)
