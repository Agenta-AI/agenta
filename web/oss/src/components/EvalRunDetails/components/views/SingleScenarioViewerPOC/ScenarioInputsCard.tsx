import {memo} from "react"

import {Card, CardContent, CardHeader, CardTitle} from "@agenta/primitive-ui/components/card"

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
            <Card>
                <CardHeader>
                    <CardTitle>Inputs</CardTitle>
                </CardHeader>
                <CardContent>
                    <span className="text-muted-foreground">Loading inputs…</span>
                </CardContent>
            </Card>
        )
    }

    if (columns.length > 0) {
        return (
            <Card>
                <CardHeader>
                    <CardTitle>Inputs</CardTitle>
                </CardHeader>
                <CardContent>
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
                </CardContent>
            </Card>
        )
    }

    if (steps.length > 0) {
        return (
            <Card>
                <CardHeader>
                    <CardTitle>Inputs</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="flex flex-col gap-4">
                        {steps.map((step) => (
                            <div key={step.id ?? getStepKey(step)} className="flex flex-col gap-2">
                                <span className="font-semibold">{getStepKey(step) || "Input"}</span>
                                <StepContentRenderer step={step} />
                            </div>
                        ))}
                    </div>
                </CardContent>
            </Card>
        )
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle>Inputs</CardTitle>
            </CardHeader>
            <CardContent>
                <span className="text-muted-foreground">No input data.</span>
            </CardContent>
        </Card>
    )
}

export default memo(ScenarioInputsCard)
