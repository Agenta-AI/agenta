import type {ReactNode} from "react"

import {CompletionRows} from "./CompletionRows"
import {RunsPanelHeader} from "./RunsPanelHeader"

export interface RunsPanelProps {
    /** The revision that runs. */
    revisionId: string
    /** The line under each output with the run's numbers and the trace link. */
    renderTraceFooter?: (traceId: string) => ReactNode
    /** The test set menu in the header. */
    testsetMenu?: ReactNode
}

/** The run pane of a completion app: the header bar, then one row for each test case. */
export const RunsPanel = ({revisionId, renderTraceFooter, testsetMenu}: RunsPanelProps) => (
    <section className="flex flex-col">
        <RunsPanelHeader entityId={revisionId} testsetMenu={testsetMenu} />
        <CompletionRows entityId={revisionId} renderTraceFooter={renderTraceFooter} />
    </section>
)
