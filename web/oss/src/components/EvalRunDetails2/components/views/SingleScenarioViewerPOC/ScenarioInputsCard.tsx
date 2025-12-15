import {memo} from "react"

import {Card, Typography} from "antd"

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
                <Typography.Text type="secondary">Loading inputs…</Typography.Text>
            </Card>
        )
    }

    if (columns.length > 0) {
        return (
            <Card title="Inputs">
                <div className="flex flex-col gap-4">
                    {columns.map((column) => (
                        <div key={column.id} className="flex flex-col gap-2">
                            <Typography.Text strong>
                                {column.displayLabel ?? column.label}
                            </Typography.Text>
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
                            <Typography.Text strong>{getStepKey(step) || "Input"}</Typography.Text>
                            <StepContentRenderer step={step} />
                        </div>
                    ))}
                </div>
            </Card>
        )
    }

    return (
        <Card title="Inputs">
            <Typography.Text type="secondary">No input data.</Typography.Text>
        </Card>
    )
}

export default memo(ScenarioInputsCard)
