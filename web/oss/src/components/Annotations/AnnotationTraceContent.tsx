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
import {Skeleton, Typography} from "antd"
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
                <Skeleton active paragraph={{rows: 4}} />
            </div>
        )
    }

    if (traceQuery.isError || !rootSpan) {
        return (
            <div className="flex items-center justify-center py-10">
                <Typography.Text type="secondary">
                    {traceQuery.isError ? "Failed to load trace data" : "Trace data not available"}
                </Typography.Text>
            </div>
        )
    }

    // TraceSpan is assignable to TraceSpanNode — extra fields (key, invocationIds, children) are all optional
    return <OverviewTabItem activeTrace={rootSpan as TraceSpanNode} />
})

export default AnnotationTraceContent
