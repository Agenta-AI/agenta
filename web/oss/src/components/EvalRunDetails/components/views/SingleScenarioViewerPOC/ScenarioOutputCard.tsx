import {memo} from "react"

import {Card, Typography} from "antd"
import dynamic from "next/dynamic"

import ColumnValueView from "./ColumnValueView"
import StepContentRenderer from "./StepContentRenderer"
import type {ScenarioOutputCardProps} from "./types"
import {getStepKey, getTraceIdForStep} from "./utils"

const SharedGenerationResultUtils = dynamic(
    () => import("@agenta/oss/src/components/SharedGenerationResultUtils"),
    {ssr: false},
)

const ScenarioOutputCard = ({
    columns,
    steps,
    scenarioId,
    runId,
    primaryTrace,
    isLoading,
}: ScenarioOutputCardProps) => {
    if (isLoading) {
        return (
            <Card title="Output">
                <Typography.Text type="secondary">Loading invocation…</Typography.Text>
            </Card>
        )
    }

    if (columns.length > 0) {
        return (
            <Card title="Output">
                <div className="flex flex-col gap-4">
                    {columns.map((column) => (
                        <div key={column.id} className="flex flex-col gap-2">
                            <ColumnValueView
                                column={column}
                                scenarioId={scenarioId}
                                runId={runId}
                            />
                        </div>
                    ))}
                    {steps.length > 0 && (
                        <SharedGenerationResultUtils
                            className="!mt-1"
                            traceId={getTraceIdForStep(steps[0], primaryTrace)}
                        />
                    )}
                </div>
            </Card>
        )
    }

    if (steps.length > 0) {
        return (
            <Card title="Output">
                <div className="flex flex-col gap-4">
                    {steps.map((step) => (
                        <div key={step.id ?? getStepKey(step)} className="flex flex-col gap-2">
                            <StepContentRenderer
                                step={step}
                                includeTraceUtils
                                fallbackTrace={primaryTrace}
                            />
                        </div>
                    ))}
                </div>
            </Card>
        )
    }

    return (
        <Card title="Output">
            <Typography.Text type="secondary">No invocation data.</Typography.Text>
        </Card>
    )
}

export default memo(ScenarioOutputCard)
