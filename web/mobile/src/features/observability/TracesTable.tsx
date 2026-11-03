import type {Key} from "react"

import {openTraceDrawerAtom} from "@agenta/observability/traceDrawer"
import {ObservabilityTracesTable} from "@agenta/observability-ui"
import {useSetAtom} from "jotai"

import {ObservabilityEmpty, ObservabilityListSkeleton} from "./states/ObservabilityStates"

/**
 * The traces table — the shared component, through the shared shell.
 *
 * The shell owns sizing (`autoHeight` fills the flex parent), so nothing is threaded through
 * here; passing a height once made the body a fixed few hundred pixels with dead space below.
 */
export const TracesTable = ({
    selectedRowKeys,
    onSelectionChange,
}: {
    selectedRowKeys: Key[]
    onSelectionChange: (keys: Key[]) => void
}) => {
    const openTraceDrawer = useSetAtom(openTraceDrawerAtom)

    return (
        <ObservabilityTracesTable
            className="min-h-0 flex-1"
            loadingState={<ObservabilityListSkeleton />}
            emptyState={<ObservabilityEmpty />}
            rowSelection={{
                type: "checkbox",
                selectedRowKeys,
                onChange: (keys) => onSelectionChange(keys),
            }}
            // Tapping a row opens the trace drawer.
            onRowClick={(record) =>
                openTraceDrawer({
                    traceId: record.trace_id || record.key,
                    activeSpanId: record.span_id ?? null,
                })
            }
        />
    )
}

export default TracesTable
