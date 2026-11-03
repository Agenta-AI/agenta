import type {ReactNode} from "react"

import {useExecutionRow} from "../../hooks/useExecutionRow"
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
        <div className="flex flex-col gap-2 border-0 border-t border-solid border-border pt-3">
            <span className="text-xs font-medium text-muted-foreground">Output</span>
            <RunResult
                isRunning={row.isBusy}
                result={result}
                traceId={row.traceId}
                repeats={row.repetitionProps}
                renderTraceFooter={renderTraceFooter}
            />
        </div>
    )
}
