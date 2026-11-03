import {traceEntityAtomFamily, traceRootSpanAtomFamily} from "@agenta/entities/trace"
import type {TraceSpanNode} from "@agenta/observability"
import {OverviewTabItem} from "@agenta/observability-ui/traceDrawer"
import {SkeletonBlock} from "@agenta/ui/ui"
import {useAtomValue} from "jotai"

import {ScenarioMessage} from "./ScenarioMessage"

/** A trace item: the trace drawer's overview of the root span (inputs, outputs, parameters). */
export const TraceScenarioContent = ({traceId}: {traceId: string}) => {
    const traceQuery = useAtomValue(traceEntityAtomFamily(traceId))
    const rootSpan = useAtomValue(traceRootSpanAtomFamily(traceId))

    if (traceQuery.isPending) {
        return (
            <div className="flex flex-col gap-3 p-4" role="status" aria-label="Loading the trace">
                <SkeletonBlock className="h-4 w-24" />
                <SkeletonBlock className="h-24" />
                <SkeletonBlock className="h-4 w-24" />
                <SkeletonBlock className="h-24" />
            </div>
        )
    }
    if (traceQuery.isError) return <ScenarioMessage title="Failed to load trace data" />
    if (!rootSpan) return <ScenarioMessage title="Trace data not available" />
    // The root span carries every field the overview reads; the tree fields it lacks are optional.
    return <OverviewTabItem activeTrace={rootSpan as TraceSpanNode} />
}
