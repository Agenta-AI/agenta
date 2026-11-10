import type {ReactNode} from "react"

import {useExecutionRow} from "../../hooks/useExecutionRow"
import {RevisionResultCard} from "../runs/RevisionResultCard"
import {RunResult} from "../runs/RunResult"

export interface FocusOutputsProps {
    rowId: string
    entityId: string
    renderTraceFooter?: (traceId: string) => ReactNode
}

/** The run of one test case under the drawer's form: the output or error, its repeats and the trace footer. */
export const FocusOutputs = ({rowId, entityId, renderTraceFooter}: FocusOutputsProps) => {
    const row = useExecutionRow({entityId, rowId})
    const result = (row.displayResult ?? null) as React.ComponentProps<typeof RunResult>["result"]
    return (
        <div className="flex flex-col">
            <div className="border-0 border-y border-solid border-border bg-muted px-4 py-2 text-sm font-medium">
                Outputs
            </div>
            <div className="px-4 pb-4 pt-3">
                <RevisionResultCard entityId={entityId}>
                    <RunResult
                        isRunning={row.isBusy}
                        result={result}
                        traceId={row.traceId}
                        repeats={row.repetitionProps}
                        renderTraceFooter={renderTraceFooter}
                    />
                </RevisionResultCard>
            </div>
        </div>
    )
}
