import {useMemo} from "react"

import {useObservability} from "@agenta/observability"
import {getObservabilityColumns, type ObservabilityTraceRow} from "@agenta/observability-ui"
import {VirtualTable} from "@agenta/ui/table"

import {ObservabilityEmpty, ObservabilityListSkeleton} from "./states/ObservabilityStates"

/** Desktop renders ~128px rows; the windowing is uniform-height, so it has to match. */
const ROW_HEIGHT = 128

/**
 * The traces table — the same columns the desktop renders, on the antd-free `VirtualTable`.
 *
 * This is the point of replacing the render leaf: `/m` can now show the real table instead of a
 * stacked list that drifts from the app it replaces, without pulling antd into a bundle whose
 * defining constraint is not having it.
 */
export const TracesTable = ({height}: {height: number}) => {
    const {traces, isLoading, fetchMoreTraces, hasMoreTraces} = useObservability()

    const columns = useMemo(() => getObservabilityColumns({evaluatorSlugs: []}), [])

    if (isLoading && traces.length === 0) return <ObservabilityListSkeleton />

    return (
        <VirtualTable<ObservabilityTraceRow>
            columns={columns}
            dataSource={traces as ObservabilityTraceRow[]}
            rowKey={(row, index) => row.key ?? row.span_id ?? index}
            rowHeight={128}
            height={height}
            emptyText={<ObservabilityEmpty />}
            onScroll={(event) => {
                const node = event.currentTarget
                const remaining = node.scrollHeight - node.scrollTop - node.clientHeight
                if (remaining < 300 && hasMoreTraces) fetchMoreTraces()
            }}
        />
    )
}

export default TracesTable
