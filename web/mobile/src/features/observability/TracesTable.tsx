import type {Key} from "react"

import {ObservabilityTracesTable} from "@agenta/observability-ui"

import {ObservabilityEmpty, ObservabilityListSkeleton} from "./states/ObservabilityStates"

/**
 * The traces table — the SAME component web/oss renders, through the SAME shell.
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
}) => (
    <ObservabilityTracesTable
        className="min-h-0 flex-1"
        loadingState={<ObservabilityListSkeleton />}
        emptyState={<ObservabilityEmpty />}
        rowSelection={{
            type: "checkbox",
            selectedRowKeys,
            onChange: (keys) => onSelectionChange(keys),
        }}
    />
)

export default TracesTable
