import {ObservabilitySessionsTable} from "@agenta/observability-ui"

import {ObservabilityEmpty, ObservabilityListSkeleton} from "./states/ObservabilityStates"

/**
 * The sessions table — the SAME component web/oss renders, for desktop-width viewports.
 *
 * Phones keep the stacked card list; anything wider gets the real table, so `/m` does not
 * drift from the app it replaces.
 */
export const SessionsTable = () => (
    <ObservabilitySessionsTable
        className="min-h-0 flex-1"
        loadingState={<ObservabilityListSkeleton />}
        emptyState={
            <ObservabilityEmpty
                title="No sessions yet"
                hint="Sessions appear here once your app groups traces by session id."
            />
        }
    />
)

export default SessionsTable
