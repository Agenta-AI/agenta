import {ObservabilitySessionsTable} from "@agenta/observability-ui"

import {ObservabilityEmpty, ObservabilityListSkeleton} from "./states/ObservabilityStates"

/**
 * The sessions table — the SAME component web/oss renders, for desktop-width viewports.
 *
 * Mirrors TracesTable: phones keep the stacked card list, which is the right shape for a
 * narrow screen, and anything wide enough gets the real table so `/m` does not drift from the
 * app it is meant to replace.
 */
export const SessionsTable = ({height}: {height: number}) => (
    <ObservabilitySessionsTable
        autoHeight={false}
        loadingState={<ObservabilityListSkeleton />}
        emptyState={
            <ObservabilityEmpty
                title="No sessions yet"
                hint="Sessions appear here once your app groups traces by session id."
            />
        }
        className="min-h-0 flex-1"
        tableProps={{style: {height}}}
    />
)

export default SessionsTable
