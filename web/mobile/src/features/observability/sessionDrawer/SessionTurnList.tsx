import type {TraceSpanNode} from "@agenta/observability"
import {useAtomValue} from "jotai"

import {observabilitySessionAnnotationsVisibleAtom} from "./sessionDrawerPreferences"
import {SessionSummary} from "./SessionSummary"
import {SessionTurnPanel} from "./SessionTurnPanel"
import type {SessionStats} from "./sessionTurns"

interface SessionTurnListProps {
    /** The traces, oldest first. */
    traces: TraceSpanNode[]
    stats: SessionStats | null
    /** The request may have left traces out. */
    truncated: boolean
    annotationsBeside: boolean
}

/** The summary, then one panel per trace. This column scrolls on its own. */
export const SessionTurnList = ({
    traces,
    stats,
    truncated,
    annotationsBeside,
}: SessionTurnListProps) => {
    const annotationsVisible = useAtomValue(observabilitySessionAnnotationsVisibleAtom)
    return (
        <section className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
            {stats ? <SessionSummary stats={stats} /> : null}
            {truncated ? (
                <p className="m-0 text-sm text-muted-foreground">
                    Showing {traces.length} traces. This session has more.
                </p>
            ) : null}
            {traces.map((trace, index) => (
                <SessionTurnPanel
                    key={trace.span_id}
                    trace={trace}
                    index={index}
                    annotationsVisible={annotationsVisible}
                    annotationsBeside={annotationsBeside}
                />
            ))}
        </section>
    )
}
