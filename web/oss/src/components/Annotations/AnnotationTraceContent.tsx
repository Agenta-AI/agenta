/**
 * AnnotationTraceContent
 *
 * OSS renderer for trace data in the annotation session.
 * Wraps the OverviewTabItem from the trace drawer to provide rich
 * drill-in rendering (message detection, format switching, etc.).
 *
 * Injected into @agenta/annotation-ui via the TraceContentRenderer
 * context slot — see AnnotationUIContext.
 */

import {memo} from "react"

import type {TraceContentRendererProps} from "@agenta/annotation-ui"
import {traceEntityAtomFamily, traceRootSpanAtomFamily} from "@agenta/entities/trace"
import {Skeleton} from "@agenta/primitive-ui/components/skeleton"
import {useAtomValue} from "jotai"

import OverviewTabItem from "@/oss/components/SharedDrawers/TraceDrawer/components/TraceContent/components/OverviewTabItem"
import type {TraceSpanNode} from "@/oss/services/tracing/types"

const AnnotationTraceContent = memo(function AnnotationTraceContent({
    traceId,
}: TraceContentRendererProps) {
    const traceQuery = useAtomValue(traceEntityAtomFamily(traceId))
    const rootSpan = useAtomValue(traceRootSpanAtomFamily(traceId))

    if (traceQuery.isPending) {
        return (
            <div className="p-4">
                <div className="flex w-full flex-col gap-3">
                    <Skeleton className="h-4 w-2/5" />
                    <Skeleton className="h-3 w-full" />
                    <Skeleton className="h-3 w-full" />
                    <Skeleton className="h-3 w-full" />
                    <Skeleton className="h-3 w-3/5" />
                </div>
            </div>
        )
    }

    if (traceQuery.isError || !rootSpan) {
        return (
            <div className="flex items-center justify-center py-10">
                <span className="text-muted-foreground">
                    {traceQuery.isError ? "Failed to load trace data" : "Trace data not available"}
                </span>
            </div>
        )
    }

    // TraceSpan is assignable to TraceSpanNode — extra fields (key, invocationIds, children) are all optional
    return <OverviewTabItem activeTrace={rootSpan as TraceSpanNode} />
})

export default AnnotationTraceContent
