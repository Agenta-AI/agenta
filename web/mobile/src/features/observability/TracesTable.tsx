import {ObservabilityTracesTable} from "@agenta/observability-ui"

import {ObservabilityEmpty, ObservabilityListSkeleton} from "./states/ObservabilityStates"

/**
 * The traces table — the SAME component web/oss renders, through the SAME shell.
 *
 * This used to be a reduced copy: its own columns, row keys, empty handling and a hand-rolled
 * loadMore in onScroll. All of that lives in @agenta/observability-ui now, and since
 * @agenta/ui is runtime antd-free, `/m` gets the full shell rather than a stripped one.
 * What stays here is only what is genuinely mobile's: its skeleton and empty states.
 */
export const TracesTable = ({height}: {height: number}) => (
    <ObservabilityTracesTable
        autoHeight={false}
        loadingState={<ObservabilityListSkeleton />}
        emptyState={<ObservabilityEmpty />}
        className="min-h-0 flex-1"
        tableProps={{style: {height}}}
    />
)

export default TracesTable
