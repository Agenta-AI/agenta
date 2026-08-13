import {ObservabilityTracesTable} from "@agenta/observability-ui"

import {ObservabilityEmpty, ObservabilityListSkeleton} from "./states/ObservabilityStates"

/**
 * The traces table, now the SAME component web/oss renders.
 *
 * This file used to carry its own columns, row keys, empty handling and a hand-rolled
 * bottom-detection in `onScroll` — a second implementation that drifted from the desktop one.
 * All of that moved into `@agenta/observability-ui`; what stays here is only what is genuinely
 * mobile's: its own skeleton and empty states.
 */
export const TracesTable = ({height}: {height: number}) => (
    <ObservabilityTracesTable
        height={height}
        loadingState={<ObservabilityListSkeleton />}
        emptyState={<ObservabilityEmpty />}
    />
)

export default TracesTable
