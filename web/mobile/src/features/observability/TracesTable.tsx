import {ObservabilityTracesTable} from "@agenta/observability-ui"

import {ObservabilityEmpty, ObservabilityListSkeleton} from "./states/ObservabilityStates"

/**
 * The traces table — the SAME component web/oss renders, through the SAME shell.
 *
 * No explicit height: the shell's `autoHeight` fills the flex parent, which is what web/oss
 * relies on too. Passing one made the body a fixed few hundred pixels with dead space below.
 */
export const TracesTable = () => (
    <ObservabilityTracesTable
        className="min-h-0 flex-1"
        loadingState={<ObservabilityListSkeleton />}
        emptyState={<ObservabilityEmpty />}
    />
)

export default TracesTable
